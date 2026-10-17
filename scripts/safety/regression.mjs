import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const env = {
  ...process.env,
  SUPABASE_WORKDIR:
    process.env.SAFETY_LOCAL_DIR ?? join(tmpdir(), "planit-safety-local"),
  PLAYWRIGHT_MODE: "safety",
};
for (const [command, args] of [
  ["npm", ["test"]],
  ["npx", ["playwright", "test"]],
]) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
