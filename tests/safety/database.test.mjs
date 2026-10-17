import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

// Dedicated, disposable local stack. Never accept a hosted target.
const target =
  process.env.SAFETY_TEST_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!["127.0.0.1", "localhost"].includes(new URL(target).hostname))
  throw new Error("Local safety tests only");
const site = "11111111-1111-4111-8111-111111111111";
const south = "22222222-2222-4222-8222-222222222222";
const supervisor = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const crew = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const outsider = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const profile = {
  state: "FL",
  employer_sector: "private",
  classification: "operations_maintenance",
  enabled: true,
};
const job = {
  task: "electrical_maintenance",
  description: "Inspect generation equipment",
  equipment: "Generator",
  conditions: "Unknown grounding",
  energized: "unknown",
};

test("database: access, immutable review, publication, fencing and exact receipts", async () => {
  const db = new pg.Client({ connectionString: target });
  await db.connect();
  await db.query("begin");
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
  const rejects = async (action, pattern) => {
    await q("savepoint denied");
    await assert.rejects(action, pattern);
    await q("rollback to denied");
  };
  try {
    await q(
      "update private.safety_settings set enabled=true,model='fake-model'",
    );
    const save = [site, "2099-06-10", 0, 0, profile, job];
    for (const user of [crew, other, outsider])
      await rejects(
        () =>
          as(
            user,
            "select public.save_safety_context($1,$2,$3,$4,$5,$6)",
            save,
          ),
        /Supervisor/,
      );
    await as(
      supervisor,
      "select public.save_safety_context($1,$2,$3,$4,$5,$6)",
      save,
    );
    await rejects(
      () =>
        as(
          supervisor,
          "select public.save_safety_context($1,$2,$3,$4,$5,$6)",
          save,
        ),
      /Context changed/,
    );
    for (const table of [
      "site_safety_profiles",
      "job_plans",
      "safety_briefing_runs",
      "safety_briefing_revisions",
      "safety_run_evidence",
    ]) {
      assert.equal((await as(crew, `select * from public.${table}`)).length, 0);
      await rejects(
        () => as(crew, `delete from public.${table}`),
        /permission denied/,
      );
    }
    await rejects(
      () =>
        as(outsider, "select public.get_safety_workspace($1,$2)", [
          site,
          "2099-06-10",
        ]),
      /membership/,
    );
    // A supervisor at only South cannot manage North.
    await q("insert into public.site_memberships values($1,$2,'supervisor')", [
      south,
      outsider,
    ]);
    await rejects(
      () =>
        as(outsider, "select public.request_safety_briefing($1,$2)", [
          site,
          "2099-06-10",
        ]),
      /Supervisor/,
    );
    const [{ id: runId }] = await as(
      supervisor,
      "select public.request_safety_briefing($1,$2) id",
      [site, "2099-06-10"],
    );
    assert.equal(
      (
        await as(
          supervisor,
          "select public.request_safety_briefing($1,$2) id",
          [site, "2099-06-10"],
        )
      )[0].id,
      runId,
    );
    const [run] = await q("select * from public.claim_safety_runs(1)");
    assert.equal(run.id, runId);
    assert.equal(
      (await q("select * from public.claim_safety_runs(1)")).length,
      0,
    );
    await rejects(
      () => as(crew, "select * from public.claim_safety_runs(1)"),
      /permission denied/,
    );
    await rejects(
      () =>
        q("select public.bind_safety_hazards($1,gen_random_uuid())", [runId]),
      /Lease lost/,
    );
    const [{ data: bound }] = await q(
      "select public.bind_safety_hazards($1,$2) data",
      [runId, run.lease_token],
    );
    const content = {
      worker_items: [],
      supervisor_items: [],
      coverage_gaps: bound.coverage_gaps,
      admin_notes: "PRIVATE",
    };
    const bad = {
      ...content,
      worker_items: [
        {
          type: "legal_requirement",
          task: job.task,
          text: "Maintain 3 feet",
          explanation: "",
          conditions: "",
          applicability: "supported",
          evidence_ids: ["invented"],
        },
      ],
    };
    await rejects(
      () =>
        q("select public.finish_safety_run($1,$2,$3)", [
          runId,
          run.lease_token,
          bad,
        ]),
      /Unauthorized citation/,
    );
    assert.equal(
      (
        await q("select public.finish_safety_run($1,gen_random_uuid(),$2) ok", [
          runId,
          content,
        ])
      )[0].ok,
      false,
    );
    await q("select public.finish_safety_run($1,$2,$3)", [
      runId,
      run.lease_token,
      content,
    ]);
    const [revision] = await q(
      "select * from public.safety_briefing_revisions where run_id=$1",
      [runId],
    );
    for (const user of [crew, other, outsider])
      await rejects(
        () =>
          as(user, "select public.publish_safety_revision($1,$2)", [
            revision.id,
            revision.revision,
          ]),
        /Supervisor/,
      );
    const [{ id: pub }] = await as(
      supervisor,
      "select public.publish_safety_revision($1,$2) id",
      [revision.id, revision.revision],
    );
    const [{ data: workspace }] = await as(
      crew,
      "select public.get_safety_workspace($1,$2) data",
      [site, "2099-06-10"],
    );
    assert.equal(workspace.context, undefined);
    assert.equal(workspace.revision, undefined);
    assert.ok(!JSON.stringify(workspace).includes("PRIVATE"));
    await as(crew, "select public.acknowledge_safety_publication($1)", [pub]);
    await as(crew, "select public.acknowledge_safety_publication($1)", [pub]);
    assert.equal(
      (
        await q(
          "select * from public.safety_briefing_reads where publication_id=$1",
          [pub],
        )
      ).length,
      1,
    );
    const [{ id: edited }] = await as(
      supervisor,
      "select public.edit_safety_revision($1,$2,$3) id",
      [revision.id, revision.revision, { ...content, admin_notes: "Reviewed" }],
    );
    await rejects(
      () =>
        as(supervisor, "select public.publish_safety_revision($1,$2)", [
          revision.id,
          revision.revision,
        ]),
      /Revision changed/,
    );
    const [{ id: pub2 }] = await as(
      supervisor,
      "select public.publish_safety_revision($1,$2) id",
      [edited, revision.revision + 1],
    );
    assert.equal(
      (
        await as(crew, "select public.get_safety_workspace($1,$2) data", [
          site,
          "2099-06-10",
        ])
      )[0].data.publication.acknowledged,
      false,
    );
    await rejects(
      () => as(crew, "select public.acknowledge_safety_publication($1)", [pub]),
      /no longer current/,
    );
    await as(
      supervisor,
      "select public.save_safety_context($1,$2,$3,$4,$5,$6)",
      [site, "2099-06-10", 1, 1, profile, { ...job, description: "Changed" }],
    );
    assert.equal(
      (
        await as(supervisor, "select public.get_safety_workspace($1,$2) data", [
          site,
          "2099-06-10",
        ])
      )[0].data.revision_stale,
      true,
    );
    assert.equal(
      (
        await q(
          "select needs_review from public.safety_briefing_publications where id=$1",
          [pub2],
        )
      )[0].needs_review,
      true,
    );
    await rejects(
      () =>
        as(crew, "select public.acknowledge_safety_publication($1)", [pub2]),
      /no longer current/,
    );
    await rejects(
      () =>
        as(supervisor, "select public.publish_safety_revision($1,$2)", [
          edited,
          revision.revision + 1,
        ]),
      /Inputs changed/,
    );
    await as(supervisor, "select public.withdraw_safety_publication($1)", [
      pub2,
    ]);
    assert.equal(
      (
        await q(
          "select status from public.safety_briefing_publications where id=$1",
          [pub2],
        )
      )[0].status,
      "withdrawn",
    );
    // Expired lease recovery and stale token fencing.
    const [{ id: retryId }] = await as(
      supervisor,
      "select public.request_safety_briefing($1,$2) id",
      [site, "2099-06-10"],
    );
    const [first] = await q("select * from public.claim_safety_runs(1)");
    await q(
      "update public.safety_briefing_runs set leased_until=now()-interval '1 second' where id=$1",
      [retryId],
    );
    const [second] = await q("select * from public.claim_safety_runs(1)");
    assert.notEqual(first.lease_token, second.lease_token);
    assert.equal(
      (
        await q(
          "select public.finish_safety_run($1,$2,null,'provider_unavailable') ok",
          [retryId, first.lease_token],
        )
      )[0].ok,
      false,
    );
    await q(
      "select public.finish_safety_run($1,$2,null,'provider_unavailable')",
      [retryId, second.lease_token],
    );
    assert.equal(
      (
        await q("select state from public.safety_briefing_runs where id=$1", [
          retryId,
        ])
      )[0].state,
      "queued",
    );
  } finally {
    await db.query("rollback");
    await db.end();
  }
});
