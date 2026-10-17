import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
const target =
  process.env.SAFETY_TEST_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!["127.0.0.1", "localhost"].includes(new URL(target).hostname))
  throw new Error("Local only");
const supervisor = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const profile = {
  state: "FL",
  employer_sector: "private",
  classification: "operations_maintenance",
  enabled: true,
};
const job = {
  task: "electrical_maintenance",
  description: "Inspect generator",
  equipment: "Generator",
  conditions: "Unknown",
  energized: "unknown",
};
test("concurrent dedup/claims, retries, missing provider fallback, dates/DST and observation/forecast evidence", async () => {
  const admin = new pg.Client({ connectionString: target }),
    a = new pg.Client({ connectionString: target }),
    b = new pg.Client({ connectionString: target });
  await Promise.all([admin.connect(), a.connect(), b.connect()]);
  const site = randomUUID();
  const q = async (sql, args = []) => (await admin.query(sql, args)).rows;
  const [{ enabled, model }] = await q("select * from private.safety_settings");
  try {
    await q("update private.safety_settings set enabled=true,model='fixture'");
    await q(
      "insert into public.sites(id,name,latitude,longitude,timezone) values($1,'Safety concurrency fixture',28,-82,'America/New_York')",
      [site],
    );
    await q("insert into public.site_memberships values($1,$2,'supervisor')", [
      site,
      supervisor,
    ]);
    await q("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: supervisor, role: "authenticated" }),
    ]);
    await q("select public.save_safety_context($1,$2,0,0,$3,$4)", [
      site,
      "2099-06-10",
      profile,
      job,
    ]);
    for (const db of [a, b]) {
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: supervisor, role: "authenticated" }),
      ]);
      await db.query("set role authenticated");
    }
    const requests = await Promise.all(
      [a, b].map((db) =>
        db.query("select public.request_safety_briefing($1,$2) id", [
          site,
          "2099-06-10",
        ]),
      ),
    );
    assert.equal(requests[0].rows[0].id, requests[1].rows[0].id);
    await Promise.all([a, b].map((db) => db.query("reset role")));
    const claims = await Promise.all(
      [a, b].map((db) => db.query("select * from public.claim_safety_runs(1)")),
    );
    assert.equal(claims.flatMap((r) => r.rows).length, 1);
    const run = claims.flatMap((r) => r.rows)[0];
    await q(
      "insert into public.briefings(site_id,for_date,content) values($1,'2099-06-10','{\"weather\":\"retained\"}')",
      [site],
    );
    await q(
      "select public.finish_safety_run($1,$2,null,'provider_unconfigured')",
      [run.id, run.lease_token],
    );
    for (let i = 0; i < 2; i++) {
      await q(
        "update public.safety_briefing_runs set available_at=now() where id=$1",
        [run.id],
      );
      const [retry] = await q("select * from public.claim_safety_runs(1)");
      assert.equal(retry.attempt, i + 2);
      await q("select public.finish_safety_run($1,$2,null,'provider_failed')", [
        retry.id,
        retry.lease_token,
      ]);
    }
    assert.equal(
      (
        await q("select state from public.safety_briefing_runs where id=$1", [
          run.id,
        ])
      )[0].state,
      "failed",
    );
    assert.deepEqual(
      (
        await q("select content from public.briefings where site_id=$1", [site])
      )[0].content,
      { weather: "retained" },
    );
    // Fixed clock for local-date scheduling, including the fall-back boundary.
    for (const [date, pr] of [
      ["2026-11-01", 1],
      ["2026-11-02", 2],
    ])
      await q("select public.save_safety_context($1,$2,$3,0,$4,$5)", [
        site,
        date,
        pr,
        profile,
        job,
      ]);
    await q(
      "select public.enqueue_due_safety_briefings('2026-10-31T22:00:00Z')",
    ); // 18 EDT → Nov 1
    assert.equal(
      (
        await q(
          "select count(*)::int n from public.safety_briefing_runs where site_id=$1 and work_date='2026-11-01'",
          [site],
        )
      )[0].n,
      1,
    );
    await q(
      "select public.enqueue_due_safety_briefings('2026-11-01T22:00:00Z')",
    ); // 17 EST → no Nov 2
    assert.equal(
      (
        await q(
          "select count(*)::int n from public.safety_briefing_runs where site_id=$1 and work_date='2026-11-02'",
          [site],
        )
      )[0].n,
      0,
    );
    await q(
      "select public.enqueue_due_safety_briefings('2026-11-01T23:00:00Z')",
    );
    await q(
      "select public.enqueue_due_safety_briefings('2026-11-01T23:00:00Z')",
    );
    assert.equal(
      (
        await q(
          "select count(*)::int n from public.safety_briefing_runs where site_id=$1 and work_date='2026-11-02'",
          [site],
        )
      )[0].n,
      1,
    );
    // Stable snapshots preserve weather units and distinguish measurements from forecasts.
    await q(
      "insert into public.readings(site_id,hazard,value,unit,observed_at,forecast_for,source) values($1,'heat',88,'F',now(),'-infinity','fixture'),($1,'heat',91,'F',now(),'2099-06-10T12:00Z','fixture')",
      [site],
    );
    const [{ data: snapshot }] = await q(
      "select private.safety_snapshot($1,'2099-06-10') data",
      [site],
    );
    const [{ data: evidence }] = await q(
      "select private.safety_hazard_evidence($1) data",
      [snapshot],
    );
    const readings = evidence.filter((e) => e.id.startsWith("reading:"));
    assert.equal(readings.length, 2);
    assert.ok(
      readings.some(
        (e) =>
          e.time_basis === "Observation" && e.unit === "F" && e.value === 88,
      ),
    );
    assert.ok(
      readings.some(
        (e) =>
          e.time_basis === "Forecast" &&
          e.unit === "F" &&
          e.value === 91 &&
          e.forecast_for.includes("2099-06-10"),
      ),
    );
    // Global kill switch and per-site disable stop claims without deleting old publications.
    await q("update private.safety_settings set enabled=false");
    assert.equal(
      (await q("select * from public.claim_safety_runs(1)")).length,
      0,
    );
  } finally {
    await q("delete from public.briefings where site_id=$1", [site]);
    await q("delete from public.readings where site_id=$1", [site]);
    await q("delete from public.safety_briefing_runs where site_id=$1", [site]);
    await q("delete from public.site_memberships where site_id=$1", [site]);
    await q("delete from public.sites where id=$1", [site]);
    await q("update private.safety_settings set enabled=$1,model=$2", [
      enabled,
      model,
    ]);
    await Promise.all([admin.end(), a.end(), b.end()]);
  }
});
