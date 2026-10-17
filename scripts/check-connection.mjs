import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/*
 * Read-only check that the frontend's Supabase settings work: the project is
 * reachable, the key is accepted, and (optionally) a real user can sign in and
 * read what the crew screens read. Never prints keys or passwords.
 *
 *   npm run check:connection
 *   CHECK_EMAIL=you@example.com CHECK_PASSWORD='…' npm run check:connection
 */
function readEnv(file) {
  try {
    return Object.fromEntries(
      readFileSync(file, "utf8")
        .split("\n")
        .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
        .filter(Boolean)
        .map(([, key, value]) => [key, value.replace(/^["']|["']$/g, "")]),
    );
  } catch {
    return {};
  }
}

const env = { ...readEnv(".env"), ...readEnv(".env.local"), ...process.env };
const url = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
};

if (
  !url ||
  !anonKey ||
  url.includes("YOUR-PROJECT-REF") ||
  anonKey.startsWith("YOUR-")
) {
  console.error(
    "Missing settings. Copy .env.example to .env.local and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
  );
  process.exit(1);
}

const host = new URL(url).hostname;
const local = ["localhost", "127.0.0.1"].includes(host);
console.log(
  `Target: ${local ? "local Docker stack" : "hosted project"} (${host})`,
);
if (!local && !host.endsWith(".supabase.co"))
  console.log("Note: host is not *.supabase.co (custom domain or proxy?).");

try {
  const response = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: anonKey },
  });
  check(
    "Project reachable and anon key accepted",
    response.ok,
    `HTTP ${response.status}`,
  );
  if (response.ok) {
    const settings = await response.json();
    check("Email sign-in enabled", settings.external?.email !== false);
  }
} catch (error) {
  check("Project reachable", false, error.message);
}

if (env.CHECK_EMAIL && env.CHECK_PASSWORD) {
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false },
  });
  const signedIn = await supabase.auth.signInWithPassword({
    email: env.CHECK_EMAIL,
    password: env.CHECK_PASSWORD,
  });
  check("Sign in", !signedIn.error, signedIn.error?.message);
  if (!signedIn.error) {
    const sites = await supabase.from("sites").select("id,name").order("name");
    check(
      "Read sites (row-level security)",
      !sites.error,
      sites.error?.message ?? `${sites.data.length} site(s) visible`,
    );
    if (!sites.error && sites.data.length === 0)
      console.log(
        "  This user has no site_memberships rows, so the app will show “No sites assigned”.",
      );
    const first = sites.data?.[0];
    if (first) {
      const feed = await supabase
        .from("crew_hazard_feed")
        .select("id")
        .eq("site_id", first.id)
        .limit(1);
      check("Read crew hazard feed", !feed.error, feed.error?.message);
      const metrics = await supabase.rpc("get_site_crew_metrics", {
        p_site_id: first.id,
      });
      check("Crew metrics RPC", !metrics.error, metrics.error?.message);
      // Monitoring reads behind the alerts, risk and briefing on the crew screen.
      for (const [name, query] of [
        [
          "site_overview",
          supabase
            .from("site_overview")
            .select("site_id,risk_now")
            .eq("site_id", first.id)
            .limit(1),
        ],
        [
          "alerts",
          supabase
            .from("alerts")
            .select("id")
            .eq("site_id", first.id)
            .eq("status", "active")
            .limit(1),
        ],
        [
          "briefings",
          supabase
            .from("briefings")
            .select("id")
            .eq("site_id", first.id)
            .limit(1),
        ],
      ]) {
        const result = await query;
        check(`Read ${name}`, !result.error, result.error?.message);
      }
    }
    await supabase.auth.signOut();
  }
} else {
  console.log(
    "Skipped sign-in checks (set CHECK_EMAIL and CHECK_PASSWORD to run them).",
  );
}

process.exit(results.every(Boolean) ? 0 : 1);
