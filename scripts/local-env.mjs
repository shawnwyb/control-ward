import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// These are generated local development credentials, never cloud project secrets.
const status = JSON.parse(
  execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" }),
);
const url = new URL(status.API_URL);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
  throw new Error("Expected a local Supabase API");
writeFileSync(
  ".env.local",
  `VITE_SUPABASE_URL=${status.API_URL}\nVITE_SUPABASE_ANON_KEY=${status.ANON_KEY}\nVITE_LOCAL_DEMO=true\n`,
);
console.log("Wrote .env.local using local Supabase credentials.");
