import {
  readFile,
  writeFile,
  mkdir,
  symlink,
  readlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workdir = resolve(
  process.env.SAFETY_LOCAL_DIR ?? join(tmpdir(), "planit-safety-local"),
);
await mkdir(join(workdir, "supabase"), { recursive: true });
let config = await readFile(join(root, "supabase/config.toml"), "utf8");
config = config.replace(
  'project_id = "swamphacks2026"',
  'project_id = "planit-safety-agent"',
);
for (const [a, b] of [
  ["54321", "55321"],
  ["54322", "55322"],
  ["54320", "55320"],
  ["54329", "55329"],
  ["54323", "55323"],
  ["54324", "55324"],
  ["54327", "55327"],
  ["8083", "8183"],
])
  config = config.replaceAll(a, b);
await writeFile(join(workdir, "supabase/config.toml"), config);
for (const name of ["migrations", "seed.sql", "functions"]) {
  const from = join(root, "supabase", name),
    to = join(workdir, "supabase", name);
  try {
    await symlink(from, to);
  } catch (e) {
    if (e.code !== "EEXIST" || (await readlink(to)) !== from)
      throw new Error(
        `Existing ${to} belongs to another checkout; set SAFETY_LOCAL_DIR.`,
      );
  }
}
const command = process.argv[2] ?? "start";
const cli = (args, output = "inherit") =>
  execFileSync("supabase", [...args, "--workdir", workdir], {
    stdio: output,
    encoding: "utf8",
  });
if (command === "start") {
  cli(["start", "-x", "edge-runtime,imgproxy,logflare,vector"]);
  cli(["migration", "up", "--local"]);
  const status = JSON.parse(cli(["status", "-o", "json"], "pipe"));
  await writeFile(
    join(root, ".env.safety"),
    `VITE_SUPABASE_URL=${status.API_URL}\nVITE_SUPABASE_ANON_KEY=${status.ANON_KEY}\nVITE_LOCAL_DEMO=true\n`,
  );
  console.log(
    "Isolated safety stack ready; npm run safety:dev uses .env.safety. The shared stack and .env.local are untouched.",
  );
} else if (command === "types") {
  const types = cli(["gen", "types", "typescript", "--local"], "pipe");
  await writeFile(join(root, "src/database.types.ts"), types.trimEnd() + "\n");
} else if (command === "serve") {
  const envFile = process.argv[3];
  if (!envFile)
    throw new Error("Pass the absolute path to an ignored Edge env file");
  cli(["functions", "serve", "--env-file", resolve(envFile)]);
} else if (command === "stop") cli(["stop"]);
else
  throw new Error(
    "Use start, types, serve <env-file> or stop. No implicit database resets.",
  );
