import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
const target =
  process.env.SAFETY_TEST_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!["127.0.0.1", "localhost"].includes(new URL(target).hostname))
  throw new Error("Local only");
test("CodeAct leases, broker budgets, private traces and expiring caches preserve pipeline isolation", async () => {
  const db = new pg.Client({ connectionString: target });
  await db.connect();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  try {
    await q("begin");
    await q(
      "update private.safety_settings set enabled=true,model='test',execution_mode='pipeline'",
    );
    await q(
      "update public.automatic_safety_runs set available_at=now()+interval '1 day',leased_until=now()+interval '1 day'",
    );
    const site = randomUUID();
    await q(
      "insert into public.sites(id,name,latitude,longitude,timezone) values($1,'CodeAct fixture',28,-82,'America/New_York')",
      [site],
    );
    const runs = await q(
      "insert into public.automatic_safety_runs(site_id,work_date,fingerprint,input_snapshot,execution_mode) values($1,current_date,'pipeline','{\"model\":\"test\"}','pipeline'),($1,current_date,'codeact','{\"model\":\"test\"}','codeact') returning id,execution_mode",
      [site],
    );
    const codeactId = runs.find((r) => r.execution_mode === "codeact").id;
    const [pipeline] = await q(
      "select * from public.claim_automatic_safety_runs()",
    );
    assert.equal(pipeline.execution_mode, "pipeline");
    const [codeact] = await q(
      "select * from public.claim_codeact_safety_runs($1)",
      [codeactId],
    );
    assert.equal(codeact.execution_mode, "codeact");
    assert.deepEqual(
      await q("select * from public.claim_codeact_safety_runs($1)", [
        codeactId,
      ]),
      [],
    );
    const [{ snapshot }] = await q(
      "select public.reserve_codeact_model_call($1,$2,42000,8) snapshot",
      [codeactId, codeact.lease_token],
    );
    assert.equal(snapshot.model, "test");
    await q("savepoint budget");
    await assert.rejects(
      () =>
        q("select public.reserve_codeact_model_call($1,$2,10,8)", [
          codeactId,
          codeact.lease_token,
        ]),
      /resource limit/,
    );
    await q("rollback to budget");
    await q("select public.settle_codeact_model_call($1,$2,100)", [
      codeactId,
      codeact.lease_token,
    ]);
    assert.equal(
      (
        await q(
          "select reserved_tokens,pending_tokens from private.safety_codeact_attempts where run_id=$1",
          [codeactId],
        )
      )[0].reserved_tokens,
      100,
    );
    await q("select public.reserve_codeact_model_call($1,$2,100,8)", [
      codeactId,
      codeact.lease_token,
    ]);
    await q("select public.settle_codeact_model_call($1,$2,100)", [
      codeactId,
      codeact.lease_token,
    ]);

    await q(
      'select public.save_codeact_trace($1,$2,\'[{"type":"action","code":"print(1)"}]\')',
      [codeactId, codeact.lease_token],
    );
    assert.equal(
      (
        await q(
          "select jsonb_array_length(trace) n from private.safety_codeact_attempts where run_id=$1",
          [codeactId],
        )
      )[0].n,
      1,
    );
    await q(
      "select public.put_codeact_cache('fixture','{\"checked_at\":\"original\"}',60)",
    );
    assert.equal(
      (await q("select public.get_codeact_cache('fixture') value"))[0].value
        .checked_at,
      "original",
    );
    await q(
      "update private.safety_codeact_cache set expires_at=now()-interval '1 second' where key='fixture'",
    );
    assert.equal(
      (await q("select public.get_codeact_cache('fixture') value"))[0].value,
      null,
    );
    for (const role of ["anon", "authenticated"]) {
      assert.equal(
        (
          await q(
            "select has_function_privilege($1,'public.claim_codeact_safety_runs(uuid)','EXECUTE') allowed",
            [role],
          )
        )[0].allowed,
        false,
      );
      assert.equal(
        (
          await q(
            "select has_function_privilege($1,'public.get_codeact_cache(text)','EXECUTE') allowed",
            [role],
          )
        )[0].allowed,
        false,
      );
    }
  } finally {
    await q("rollback");
    await db.end();
  }
});
