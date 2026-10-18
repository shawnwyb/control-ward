import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// The container, not a Python allowlist, is the security boundary. No host env,
// socket, writable mount or network reaches generated code. One interpreter/run.
export function createSandbox({
  signal,
  image = "python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1",
} = {}) {
  const name = `controlward-codeact-${randomUUID()}`;
  const child = spawn(
    "docker",
    [
      "run",
      "--rm",
      "--interactive",
      "--name",
      name,
      "--network=none",
      "--read-only",
      "--user=65534:65534",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--pids-limit=32",
      "--memory=128m",
      "--memory-swap=128m",
      "--cpus=0.5",
      "--tmpfs=/tmp:rw,noexec,nosuid,size=8m",
      "--log-driver=none",
      "--mount",
      `type=bind,src=${fileURLToPath(new URL("interpreter.py", import.meta.url))},dst=/interpreter.py,readonly`,
      image,
      "python",
      "-I",
      "-u",
      "-B",
      "/interpreter.py",
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    },
  );
  let pending,
    closed = false,
    receivedBytes = 0;
  const stop = () => {
    if (closed) return;
    closed = true;
    // Killing docker's client alone would leave an orphaned, running container.
    const cleanup = spawn("docker", ["rm", "-f", name], { stdio: "ignore" });
    cleanup.unref();
    child.kill("SIGKILL");
    pending?.reject(new Error("sandbox_stopped"));
    pending = undefined;
  };
  signal?.addEventListener("abort", stop, { once: true });
  child.on("error", stop);
  child.on("exit", () => {
    pending?.reject(new Error("sandbox_exited"));
    pending = undefined;
  });
  child.stderr.resume();
  child.stdout.on("data", (chunk) => {
    receivedBytes += chunk.length;
    if (receivedBytes > 200000) stop();
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", async (line) => {
    const active = pending;
    if (!active) return stop();
    try {
      if (line.length > 80000) throw new Error("sandbox_protocol_limit");
      const message = JSON.parse(line);
      if (message.type === "tool") {
        let reply;
        try {
          reply = { value: await active.tool(message.name, message.arguments) };
        } catch (error) {
          reply = {
            error: /^[a-z_0-9]{1,80}$/.test(error.message)
              ? error.message
              : "tool_failed",
          };
        }
        if (pending === active) child.stdin.write(`${JSON.stringify(reply)}\n`);
      } else if (message.type === "result") {
        if (
          typeof message.output !== "string" ||
          message.output.length > 20000 ||
          (message.error !== null && typeof message.error !== "string")
        )
          throw new Error("invalid_execution_result");
        pending = undefined;
        active.resolve({
          output: message.output,
          error: message.error?.slice(0, 2000) ?? null,
        });
      } else throw new Error("invalid_sandbox_protocol");
    } catch {
      stop();
    }
  });
  return {
    async execute(code, tool) {
      signal?.throwIfAborted();
      if (closed || pending || typeof code !== "string" || code.length > 12000)
        throw new Error("invalid_code_action");
      receivedBytes = 0;
      // Includes time spent awaiting tools; never extends the enclosing run lease.
      const timer = setTimeout(stop, 90000);
      try {
        return await new Promise((resolve, reject) => {
          pending = { resolve, reject, tool };
          child.stdin.write(`${JSON.stringify({ code })}\n`);
        });
      } finally {
        clearTimeout(timer);
      }
    },
    close() {
      signal?.removeEventListener("abort", stop);
      stop();
      lines.close();
    },
  };
}
