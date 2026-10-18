import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { runCodeAct } from "./agent.mjs";

export async function runWorker({
  url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY,
  once = false,
  runId,
} = {}) {
  if (
    !url?.startsWith("https://") &&
    !/^http:\/\/(127\.0\.0\.1|localhost):/.test(url ?? "")
  )
    throw new Error("SUPABASE_URL must be configured");
  if (!key)
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY must be configured (never VITE_)",
    );
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
  const request = async (path, body, signal = AbortSignal.timeout(15000)) => {
    const response = await fetch(`${url}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      let category;
      if (path.startsWith("/functions/")) {
        try {
          const body = await response.json();
          if (/^[a-z_0-9]{1,80}$/.test(body.error)) category = body.error;
        } catch {
          /* status fallback */
        }
      }
      throw new Error(category ?? `server_http_${response.status}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  const rpc = (name, args = {}) => request(`/rest/v1/rpc/${name}`, args);
  do {
    const runs = await rpc("claim_codeact_safety_runs", {
      p_run_id: runId ?? null,
    });
    for (const run of runs) {
      const signal = AbortSignal.timeout(120000);
      const lease = { p_run_id: run.id, p_lease_token: run.lease_token };
      try {
        const output = await runCodeAct(run.input_snapshot, {
          signal,
          ask: (prompt, search, activeSignal) =>
            request(
              "/functions/v1/codeact-safety-model",
              { run_id: run.id, lease_token: run.lease_token, prompt, search },
              activeSignal,
            ),
          cache: {
            get: (key) => rpc("get_codeact_cache", { p_key: key }),
            put: (key, value, ttl) =>
              rpc("put_codeact_cache", {
                p_key: key,
                p_value: value,
                p_ttl_seconds: ttl,
              }),
          },
        });
        await rpc("save_codeact_trace", { ...lease, p_trace: output.trace });
        const saved = await rpc("finish_automatic_safety_run", {
          ...lease,
          p_content: output.content,
          p_documents: output.documents,
          p_diagnostics: output.diagnostics,
        });
        console.log(
          JSON.stringify({
            run_id: run.id,
            saved,
            items: output.content.items.length,
            sources: output.documents.length,
            python_actions: output.trace.filter((e) => e.type === "action")
              .length,
            tool_calls: output.trace.filter((e) => e.type === "tool").length,
          }),
        );
        if (!saved) throw new Error("lease_or_inputs_changed");
      } catch (error) {
        if (error.trace)
          await rpc("save_codeact_trace", { ...lease, p_trace: error.trace });
        const category = /^[a-z_0-9]{1,80}$/.test(error.message)
          ? error.message
          : "codeact_failed";
        await rpc("finish_automatic_safety_run", {
          ...lease,
          p_error: category,
        });
        console.error(JSON.stringify({ run_id: run.id, error: category }));
        if (once) throw new Error(category);
      }
    }
    if (!once) await delay(runs.length ? 1000 : 10000);
  } while (!once);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runWorker({
    once: process.argv.includes("--once"),
    runId: process.env.SAFETY_CODEACT_RUN_ID,
  }).catch(() => {
    console.error(
      "CodeAct worker stopped; inspect private run diagnostics and deployment configuration.",
    );
    process.exitCode = 1;
  });
}
