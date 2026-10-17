import { execFileSync } from "node:child_process";

// Intentionally cannot target a linked/hosted project.
execFileSync("supabase", ["db", "reset", "--local"], { stdio: "inherit" });
execFileSync(process.execPath, ["scripts/local-env.mjs"], { stdio: "inherit" });
