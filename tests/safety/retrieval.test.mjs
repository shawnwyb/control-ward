import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  officialCorpus,
  demoProcedure,
} from "../../supabase/functions/_shared/safety-agent/corpus.ts";
import { contentHash } from "../../supabase/functions/_shared/safety-agent/ingestion.ts";
import { runAgent } from "../../supabase/functions/_shared/safety-agent/agent.ts";
import { instructionItem } from "../../supabase/functions/_shared/safety-agent/contracts.ts";
const target =
  process.env.SAFETY_TEST_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!["127.0.0.1", "localhost"].includes(new URL(target).hostname))
  throw new Error("Local tests only");
const site = "11111111-1111-4111-8111-111111111111",
  south = "22222222-2222-4222-8222-222222222222",
  supervisor = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("retrieval and full fake-provider vertical slice: isolation, recall, review candidates and hazard invalidation", async () => {
  const db = new pg.Client({ connectionString: target });
  await db.connect();
  await db.query("begin");
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const rejected = async (fn, re) => {
    await q("savepoint rejected");
    await assert.rejects(fn, re);
    await q("rollback to rejected");
  };
  const auth = async () =>
    q("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: supervisor, role: "authenticated" }),
    ]);
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
    conditions: "Check procedure",
    energized: "deenergized",
  };
  try {
    await q(
      "update private.safety_settings set enabled=true,model='fixture-model'",
    );
    await auth();
    await q("select public.save_safety_context($1,$2,0,0,$3,$4)", [
      site,
      "2099-06-10",
      profile,
      job,
    ]);
    const versions = [];
    for (const { passages, ...source } of [
      ...officialCorpus,
      demoProcedure(site),
      demoProcedure(south),
    ]) {
      const document = passages.map((p) => p.excerpt).join("\n");
      const [{ id }] = await q(
        "select public.stage_safety_source($1,$2,$3,$4) id",
        [
          source,
          await contentHash(document, passages),
          JSON.stringify(passages),
          document,
        ],
      );
      await q("select public.review_safety_source($1,true,$2)", [
        id,
        "Fixture approval only — synthetic document, not live review.",
      ]);
      versions.push(id);
    }
    const [{ id: runId }] = await q(
      "select public.request_safety_briefing($1,$2)",
      [site, "2099-06-10"],
    ).then((rows) => rows.map((r) => ({ id: r.request_safety_briefing })));
    const [run] = await q("select * from public.claim_safety_runs(1)");
    assert.equal(run.id, runId);
    const retrieve = async (name, args = {}) =>
      (
        await q(
          "select public.retrieve_safety_evidence($1,$2,$3,$4,$5) result",
          [
            runId,
            run.lease_token,
            name,
            args.query ?? "",
            args.passage_id ?? null,
          ],
        )
      )[0].result;
    const official = await retrieve("search_regulations", {
      query: "job briefing",
    });
    assert.equal(official.length, 3, "100% labeled maintenance passage recall");
    assert.ok(
      official.some(
        (e) =>
          e.conditions.includes("working alone") ||
          e.conditions.includes("Working alone"),
      ),
    );
    const policy = await retrieve("search_site_documents");
    assert.equal(policy.length, 1);
    assert.equal(policy[0].kind, "company_policy");
    assert.ok(policy[0].title.startsWith("FICTIONAL"));
    assert.ok(!JSON.stringify(policy).includes(south));
    const [{ id: foreignPassage }] = await q(
      "select p.id from public.safety_passages p join public.safety_source_versions v on v.id=p.version_id where v.id=$1",
      [versions[4]],
    );
    assert.deepEqual(
      await retrieve("read_source_passage", { passage_id: foreignPassage }),
      [],
    );
    const [{ result: bound }] = await q(
      "select public.bind_safety_hazards($1,$2) result",
      [runId, run.lease_token],
    );
    const adapter = {
      async call(name, args) {
        if (name === "get_job_context") return { data: run.input_snapshot };
        if (name === "get_site_hazards")
          return { data: bound, evidence: bound.evidence };
        const evidence = await retrieve(name, args);
        return { data: evidence, evidence };
      },
    };
    let seen;
    const out = await runAgent(
      run.input_snapshot,
      {
        async turn(messages) {
          seen = messages;
          return {
            tokens: 100,
            final: {
              worker_items: [
                instructionItem(official[0], job.task),
                instructionItem(policy[0], job.task),
              ],
              supervisor_items: [],
              coverage_gaps: bound.coverage_gaps,
              admin_notes: "PRIVATE SUPERVISOR NOTE",
            },
          };
        },
      },
      adapter,
    );
    assert.ok(JSON.stringify(seen).includes("Hazard feed missing or stale"));
    await q("select public.finish_safety_run($1,$2,$3,null,$4)", [
      runId,
      run.lease_token,
      out.draft,
      out.diagnostics,
    ]);
    const [rev] = await q(
      "select * from public.safety_briefing_revisions where run_id=$1",
      [runId],
    );
    const [{ id: pub }] = await q(
      "select public.publish_safety_revision($1,$2) id",
      [rev.id, rev.revision],
    );
    const [{ worker_payload: payload }] = await q(
      "select worker_payload from public.safety_briefing_publications where id=$1",
      [pub],
    );
    assert.ok(!JSON.stringify(payload).includes("PRIVATE"));
    assert.equal(payload.evidence.length, 2);
    // Refresh preserves old passages and citation versions but blocks stale publication.
    const { passages, ...source } = officialCorpus[1];
    const document =
      passages.map((p) => p.excerpt).join("\n") + " Changed official footer.";
    const [{ id: candidate }] = await q(
      "select public.stage_safety_source($1,$2,$3,$4) id",
      [
        source,
        await contentHash(document, passages),
        JSON.stringify(passages),
        document,
      ],
    );
    assert.notEqual(candidate, versions[1]);
    assert.equal(
      (
        await q(
          "select status from public.safety_source_versions where id=$1",
          [candidate],
        )
      )[0].status,
      "candidate",
    );
    assert.equal(
      (
        await q(
          "select count(*)::int n from public.safety_passages where version_id=$1",
          [versions[1]],
        )
      )[0].n,
      3,
    );
    assert.equal(
      (
        await q(
          "select needs_review from public.safety_briefing_publications where id=$1",
          [pub],
        )
      )[0].needs_review,
      true,
    );
    await rejected(
      () =>
        q("select public.edit_safety_revision($1,$2,$3)", [
          rev.id,
          rev.revision,
          out.draft,
        ]),
      /Inputs changed/,
    );
    await q("select public.review_safety_source($1,false,$2)", [
      candidate,
      "Reject fixture footer change for this test.",
    ]);
    // New hazard never overwrites the published payload and appears immediately in existing alerts.
    await q(
      "insert into public.alerts(site_id,kind,level,payload,dedup_key) values($1,'other','warning','{}',$2)",
      [site, "safety-fixture-alert"],
    );
    assert.equal(
      (
        await q(
          "select needs_review from public.safety_briefing_publications where id=$1",
          [pub],
        )
      )[0].needs_review,
      true,
    );
    assert.deepEqual(
      (
        await q(
          "select worker_payload from public.safety_briefing_publications where id=$1",
          [pub],
        )
      )[0].worker_payload,
      payload,
    );
    await q(
      "update public.safety_briefing_runs set created_at=now()-interval '2 minutes' where id=$1",
      [runId],
    );
    const n = (await q("select public.refresh_stale_safety_briefings() n"))[0]
      .n;
    assert.equal(n, 1);
    assert.equal(
      (await q("select public.refresh_stale_safety_briefings() n"))[0].n,
      0,
    );
    // Unsupported jurisdiction and unknown coverage retrieve no official instructions.
    await q("select public.save_safety_context($1,$2,1,1,$3,$4)", [
      site,
      "2099-06-10",
      { ...profile, state: "CA" },
      job,
    ]);
    const [{ request_safety_briefing: wrongRun }] = await q(
      "select public.request_safety_briefing($1,$2)",
      [site, "2099-06-10"],
    );
    const rows = await q("select * from public.claim_safety_runs(2)");
    const wrong = rows.find((r) => r.id === wrongRun);
    assert.ok(wrong);
    assert.deepEqual(
      (
        await q(
          "select public.retrieve_safety_evidence($1,$2,'search_regulations') data",
          [wrong.id, wrong.lease_token],
        )
      )[0].data,
      [],
    );
  } finally {
    await db.query("rollback");
    await db.end();
  }
});
