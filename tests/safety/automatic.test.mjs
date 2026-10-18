import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { scopeGap } from "../../supabase/functions/_shared/automatic-safety/contracts.ts";

const target =
  process.env.SAFETY_TEST_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!["127.0.0.1", "localhost"].includes(new URL(target).hostname))
  throw new Error("Local only");
test("automatic checklists need no admin input and preserve citations, site access, receipts and freshness", async () => {
  const db = new pg.Client({ connectionString: target });
  await db.connect();
  const site = randomUUID();
  const supervisor = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const crew = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const outsider = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const as = async (user, sql, args = []) => {
    await q("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: user, role: "authenticated" }),
    ]);
    await q("set local role authenticated");
    const result = await q(sql, args);
    await q("reset role");
    return result;
  };
  const rejects = async (fn, pattern) => {
    await q("savepoint rejected");
    await assert.rejects(fn, pattern);
    await q("rollback to rejected");
  };
  try {
    await q("begin");
    await q(
      "insert into public.sites(id,name,latitude,longitude,timezone,eia_plant_id) values($1,'Automatic fixture',28,-82,'America/New_York',$2)",
      [site, `fixture-${site}`],
    );
    await q(
      "insert into public.site_memberships(site_id,user_id,role) values($1,$2,'supervisor'),($1,$3,'crew')",
      [site, supervisor, crew],
    );
    await q(
      "update private.safety_settings set enabled=true,model='fake-auto'",
    );
    const [{ date }] = await q(
      "select (now() at time zone 'America/New_York')::date::text as date",
    );
    const enqueue = () =>
      q(
        "select public.enqueue_automatic_safety_checklists(($1::date+time '12:00') at time zone 'America/New_York') as n",
        [date],
      );
    await enqueue();
    assert.equal(
      (
        await q("select 1 from public.site_safety_profiles where site_id=$1", [
          site,
        ])
      ).length,
      0,
    );
    assert.equal(
      (await q("select 1 from public.job_plans where site_id=$1", [site]))
        .length,
      0,
    );
    await enqueue();
    assert.equal(
      (
        await q(
          "select count(*)::int n from public.automatic_safety_runs where site_id=$1",
          [site],
        )
      )[0].n,
      1,
    );
    await rejects(
      () => as(crew, "select * from public.claim_automatic_safety_runs()"),
      /permission denied/,
    );
    let run;
    for (let i = 0; i < 100 && !run; i++) {
      const claimed = await q(
        "select * from public.claim_automatic_safety_runs()",
      );
      run = claimed.find((r) => r.site_id === site);
      if (!claimed.length) break;
    }
    assert.ok(run);
    const quote = "Fixture only: inspect current site conditions before work.";
    const sources = [
      {
        id: "source-1",
        title: "Synthetic test source",
        url: "https://www.osha.gov/heat",
        level: "federal",
        jurisdiction: "United States",
        checked_at: new Date().toISOString(),
      },
    ];
    const content = {
      summary: "Automatic fixture",
      jurisdiction: {
        state: "Florida",
        state_code: "FL",
        county: "Fixture County",
        city: null,
        resolved: true,
        source_url: "https://geocoding.geo.census.gov/",
      },
      conditions: run.input_snapshot.hazards.readings,
      alerts: run.input_snapshot.hazards.alerts,
      items: [
        {
          id: "item-1",
          kind: "guidance",
          title: "Check conditions",
          text: quote,
          conditions: "Synthetic fixture only",
          citations: [{ source_id: "source-1", quote }],
        },
      ],
      sources,
      coverage_gaps: [scopeGap],
    };
    const documents = [{ ...sources[0], text: quote }];
    const finish = (
      body = content,
      token = run.lease_token,
      docs = documents,
    ) =>
      q("select public.finish_automatic_safety_run($1,$2,$3,$4) as saved", [
        run.id,
        token,
        body,
        JSON.stringify(docs),
      ]);
    assert.equal((await finish(content, randomUUID()))[0].saved, false);
    await rejects(
      () =>
        finish({
          ...content,
          items: [{ ...content.items[0], text: "Invented instruction" }],
        }),
      /quoted source/,
    );
    await rejects(
      () =>
        finish({
          ...content,
          sources: [{ ...sources[0], url: "https://example.com/" }],
        }),
      /Official source/,
    );
    await rejects(
      () => finish(content, run.lease_token, [{ ...sources[0] }]),
      /document missing/,
    );
    await rejects(
      () =>
        finish({ ...content, items: [{ ...content.items[0], kind: null }] }),
      /Invalid automatic item/,
    );
    await rejects(
      () =>
        finish({
          ...content,
          sources: [{ ...sources[0], jurisdiction: "Wrong state" }],
        }),
      /jurisdiction mismatch/,
    );
    await rejects(
      () =>
        finish({ ...content, private_notes: "Do not publish private fields" }),
      /shape/,
    );
    await rejects(
      () =>
        q(
          "select public.finish_automatic_safety_run($1,$2,p_error=>'provider_failed',p_diagnostics=>$3)",
          [run.id, run.lease_token, { raw_prompt: "private text" }],
        ),
      /diagnostics/,
    );
    assert.equal((await finish())[0].saved, true);
    let workspace = (
      await as(
        crew,
        "select public.get_automatic_safety_workspace($1,$2) as w",
        [site, date],
      )
    )[0].w;
    assert.equal(workspace.checklist.current, true);
    assert.equal(workspace.checklist.acknowledged, false);
    assert.equal(workspace.checklist.content.items[0].text, quote);
    const checklist = workspace.checklist.id;
    await rejects(
      () =>
        as(outsider, "select public.get_automatic_safety_workspace($1,$2)", [
          site,
          date,
        ]),
      /membership/,
    );
    assert.equal(
      (
        await as(
          crew,
          "select 1 from public.automatic_safety_checklists where site_id<>$1",
          [site],
        )
      ).length,
      0,
    );
    await rejects(
      () => as(crew, "select * from public.automatic_safety_runs"),
      /permission denied/,
    );
    await as(crew, "select public.acknowledge_automatic_safety_checklist($1)", [
      checklist,
    ]);
    workspace = (
      await as(
        crew,
        "select public.get_automatic_safety_workspace($1,$2) as w",
        [site, date],
      )
    )[0].w;
    assert.equal(workspace.checklist.acknowledged, true);
    await q(
      "insert into public.lightning_state(site_id,status) values($1,'stop_work')",
      [site],
    );
    workspace = (
      await as(
        crew,
        "select public.get_automatic_safety_workspace($1,$2) as w",
        [site, date],
      )
    )[0].w;
    assert.equal(workspace.checklist.current, false);
    await rejects(
      () =>
        as(crew, "select public.acknowledge_automatic_safety_checklist($1)", [
          checklist,
        ]),
      /no longer current/,
    );
    await enqueue();
    assert.equal(
      (
        await q(
          "select count(*)::int n from public.automatic_safety_runs where site_id=$1",
          [site],
        )
      )[0].n,
      2,
    );
    // Publish the automatically queued replacement and require a new receipt.
    [run] = await q("select * from public.claim_automatic_safety_runs()");
    assert.equal(run.site_id, site);
    content.alerts = run.input_snapshot.hazards.alerts;
    content.conditions = run.input_snapshot.hazards.readings;
    assert.equal((await finish())[0].saved, true);
    workspace = (
      await as(
        crew,
        "select public.get_automatic_safety_workspace($1,$2) as w",
        [site, date],
      )
    )[0].w;
    assert.notEqual(workspace.checklist.id, checklist);
    assert.equal(workspace.checklist.acknowledged, false);
    assert.equal(workspace.checklist.current, true);
    await rejects(
      () =>
        as(crew, "select public.acknowledge_automatic_safety_checklist($1)", [
          checklist,
        ]),
      /no longer current/,
    );
    // Expiry is calculated at local midnight, including the DST transition.
    await q(
      "update public.automatic_safety_checklists set generated_at=now()-interval '5 hours' where id=$1",
      [workspace.checklist.id],
    );
    workspace = (
      await as(
        crew,
        "select public.get_automatic_safety_workspace($1,$2) as w",
        [site, date],
      )
    )[0].w;
    assert.equal(workspace.checklist.current, false);
    await q("update private.safety_settings set enabled=false");
    assert.equal(
      (await q("select * from public.claim_automatic_safety_runs()")).length,
      0,
    );
  } finally {
    await q("rollback");
    await db.end();
  }
});
