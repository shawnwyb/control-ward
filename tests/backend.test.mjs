import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const config = JSON.parse(
  execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" }),
);
for (const value of [config.API_URL, config.DB_URL]) {
  if (!["127.0.0.1", "localhost"].includes(new URL(value).hostname))
    throw new Error("Tests only run locally");
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, options);
const anonymous = createClient(config.API_URL, config.ANON_KEY, options);
const db = new pg.Pool({ connectionString: config.DB_URL });
const clients = {};
const users = {};
const sites = [];
const channels = [];
const lat = 29.652;
const lon = -82.325;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0V8AAAAASUVORK5CYII=",
  "base64",
);

function ok(result) {
  assert.equal(result.error, null, result.error?.message);
  return result.data;
}
async function site(members = ["crew", "supervisor"], radius = 5000) {
  const id = randomUUID();
  await db.query(
    "insert into public.sites(id,name,latitude,longitude,report_radius_m) values($1,$2,$3,$4,$5)",
    [id, "Automated test", lat, lon, radius],
  );
  sites.push(id);
  for (const name of members)
    await db.query(
      "insert into public.site_memberships(site_id,user_id,role) values($1,$2,$3)",
      [id, users[name], name === "supervisor" ? "supervisor" : "crew"],
    );
  return id;
}
function submit(siteId, extra = {}, client = clients.crew) {
  return client.rpc("submit_hazard_report", {
    p_request_id: randomUUID(),
    p_site_id: siteId,
    p_type: "debris",
    p_severity: 2,
    p_lat: lat,
    p_lon: lon,
    ...extra,
  });
}
function checkin(reportId, still = true, extra = {}, client = clients.crew) {
  return client.rpc("checkin_hazard_report", {
    p_request_id: randomUUID(),
    p_report_id: reportId,
    p_still_there: still,
    ...extra,
  });
}
async function age(id, hours) {
  await db.query(
    "update public.hazard_reports set last_confirmed_at=now()-($2 * interval '1 hour') where id=$1",
    [id, hours],
  );
}
async function reserve(siteId, client = clients.crew) {
  return ok(
    await client.rpc("reserve_hazard_photo", {
      p_photo_id: randomUUID(),
      p_site_id: siteId,
      p_content_type: "image/png",
    }),
  );
}

describe(
  "crew backend against real local Supabase",
  { concurrency: false },
  () => {
    before(async () => {
      for (const name of ["crew", "other", "supervisor", "outsider"]) {
        const email = `${name}-${randomUUID()}@test.planit.local`;
        const user = ok(
          await admin.auth.admin.createUser({
            email,
            password: "LocalTest123!",
            email_confirm: true,
          }),
        );
        users[name] = user.user.id;
        clients[name] = createClient(config.API_URL, config.ANON_KEY, options);
        ok(
          await clients[name].auth.signInWithPassword({
            email,
            password: "LocalTest123!",
          }),
        );
      }
    });
    after(async () => {
      for (const channel of channels) await channel.unsubscribe();
      const photos = await db.query(
        "select object_path from public.hazard_photos where site_id=any($1::uuid[])",
        [sites],
      );
      if (photos.rows.length)
        ok(
          await admin.storage
            .from("hazard-photos")
            .remove(photos.rows.map((x) => x.object_path)),
        );
      await db.query(
        "delete from private.hazard_requests where user_id=any($1::uuid[])",
        [Object.values(users)],
      );
      await db.query(
        "delete from public.hazard_photos where site_id=any($1::uuid[])",
        [sites],
      );
      await db.query(
        "delete from public.hazard_checkin_tasks where report_id in(select id from public.hazard_reports where site_id=any($1::uuid[]))",
        [sites],
      );
      await db.query(
        "delete from public.hazard_events where report_id in(select id from public.hazard_reports where site_id=any($1::uuid[]))",
        [sites],
      );
      await db.query(
        "delete from public.hazard_observations where report_id in(select id from public.hazard_reports where site_id=any($1::uuid[]))",
        [sites],
      );
      await db.query(
        "delete from public.hazard_reports where site_id=any($1::uuid[])",
        [sites],
      );
      await db.query(
        "delete from public.site_memberships where site_id=any($1::uuid[])",
        [sites],
      );
      await db.query("delete from public.sites where id=any($1::uuid[])", [
        sites,
      ]);
      for (const id of Object.values(users))
        ok(await admin.auth.admin.deleteUser(id));
      await Promise.all(
        Object.values(clients).map((c) => c.removeAllChannels()),
      );
      await db.end();
    });

    test("creates, merges nearby matching hazards, preserves maximum severity and observations", async () => {
      const id = await site();
      const first = ok(await submit(id, { p_severity: 1 }));
      const second = ok(
        await submit(id, { p_severity: 3, p_lat: lat + 0.0004 }),
      );
      assert.equal(first.outcome, "created");
      assert.equal(second.outcome, "merged");
      assert.equal(first.report.id, second.report.id);
      assert.equal(second.report.confirmations, 2);
      assert.equal(second.report.severity, 3);
      assert.equal(second.report.latitude, lat);
      assert.equal(
        ok(
          await clients.crew
            .from("hazard_observations")
            .select("*")
            .eq("report_id", first.report.id),
        ).length,
        2,
      );
    });

    test("serializes 16 simultaneous first submissions into one hazard", async () => {
      const id = await site();
      const responses = (
        await Promise.all(
          Array.from({ length: 16 }, (_, i) =>
            submit(id, { p_severity: 1 + (i % 3) }),
          ),
        )
      ).map(ok);
      assert.equal(new Set(responses.map((r) => r.report.id)).size, 1);
      assert.equal(responses.filter((r) => r.outcome === "created").length, 1);
      const [report] = ok(
        await clients.crew.from("hazard_reports").select("*").eq("site_id", id),
      );
      assert.equal(report.confirmations, 16);
      assert.equal(report.severity, 3);
    });

    test("simultaneous retries return the same result and reject changed payloads", async () => {
      const id = await site();
      const request = randomUUID();
      const results = (
        await Promise.all(
          Array.from({ length: 8 }, () =>
            submit(id, { p_request_id: request }),
          ),
        )
      ).map(ok);
      for (const result of results) assert.deepEqual(result, results[0]);
      assert.equal(results[0].report.confirmations, 1);
      assert.equal(
        (await submit(id, { p_request_id: request, p_severity: 3 })).error.code,
        "22023",
      );
    });

    test("does not merge different sites, hazard types, or pins over 100 meters apart", async () => {
      const a = await site();
      const b = await site();
      const results = [];
      for (const [id, input] of [
        [a, {}],
        [b, {}],
        [a, { p_type: "wildlife" }],
        [a, { p_lat: lat + 0.0011 }],
      ])
        results.push(ok(await submit(id, input)));
      assert.equal(new Set(results.map((r) => r.report.id)).size, 4);
      assert.ok(results.every((r) => r.outcome === "created"));
    });

    test("picks the nearest matching hazard deterministically", async () => {
      const id = await site();
      const a = ok(await submit(id, { p_lat: lat - 0.0007 }));
      const b = ok(await submit(id, { p_lat: lat + 0.0007 }));
      assert.notEqual(a.report.id, b.report.id);
      const merged = ok(await submit(id, { p_lat: lat + 0.0001 }));
      assert.equal(merged.report.id, b.report.id);
    });

    test("uses the latest confirmation for the 24-hour duplicate window", async () => {
      const id = await site();
      const first = ok(await submit(id));
      await age(first.report.id, 25);
      const second = ok(await submit(id));
      assert.notEqual(first.report.id, second.report.id);
      await db.query(
        "update public.hazard_reports set created_at=now()-interval '3 days' where id=$1",
        [second.report.id],
      );
      assert.equal(ok(await submit(id)).report.id, second.report.id);
    });

    test("enforces the 100m distance boundary with geography units", async () => {
      const id = await site();
      const first = ok(await submit(id));
      const {
        rows: [points],
      } = await db.query(
        `select
      extensions.st_y(extensions.st_project(location,99,0)::extensions.geometry) as inside,
      extensions.st_y(extensions.st_project(location,101,0)::extensions.geometry) as outside
      from public.hazard_reports where id=$1`,
        [first.report.id],
      );
      assert.equal(
        ok(await submit(id, { p_lat: points.inside })).outcome,
        "merged",
      );
      assert.equal(
        ok(await submit(id, { p_lat: points.outside })).outcome,
        "created",
      );
    });

    test("validates input on every path, including merges", async () => {
      const id = await site();
      ok(await submit(id));
      for (const extra of [
        { p_severity: 0 },
        { p_severity: 4 },
        { p_severity: null },
        { p_type: null },
        { p_lat: 91 },
        { p_lon: -181 },
        { p_lat: null },
        { p_request_id: null },
      ]) {
        assert.ok((await submit(id, extra)).error, JSON.stringify(extra));
      }
    });

    test("isolates reads, metrics, check-ins and submissions by site membership", async () => {
      const id = await site();
      const report = ok(await submit(id)).report;
      assert.deepEqual(
        ok(
          await clients.other
            .from("crew_hazard_feed")
            .select("*")
            .eq("site_id", id),
        ),
        [],
      );
      assert.deepEqual(
        ok(
          await clients.outsider
            .from("hazard_observations")
            .select("*")
            .eq("report_id", report.id),
        ),
        [],
      );
      assert.equal((await submit(id, {}, clients.other)).error.code, "42501");
      assert.equal(
        (await checkin(report.id, false, {}, clients.other)).error.code,
        "42501",
      );
      assert.equal(
        (await clients.other.rpc("get_site_crew_metrics", { p_site_id: id }))
          .error.code,
        "42501",
      );
      assert.equal(
        ok(
          await clients.supervisor
            .from("crew_hazard_feed")
            .select("*")
            .eq("site_id", id),
        ).length,
        1,
      );
      assert.ok((await submit(id, {}, anonymous)).error);
    });

    test("prevents direct client writes, fake memberships, and worker RPC access", async () => {
      const id = await site();
      const report = ok(await submit(id)).report;
      assert.ok(
        (
          await clients.crew
            .from("hazard_reports")
            .update({ severity: 3 })
            .eq("id", report.id)
        ).error,
      );
      assert.ok(
        (
          await clients.crew
            .from("site_memberships")
            .insert({ site_id: id, user_id: users.other })
        ).error,
      );
      assert.ok(
        (
          await clients.crew
            .from("hazard_observations")
            .delete()
            .eq("report_id", report.id)
        ).error,
      );
      assert.ok((await clients.crew.rpc("run_hazard_maintenance")).error);
      assert.ok((await anonymous.rpc("run_hazard_maintenance")).error);
      assert.ok(
        (
          await clients.crew.rpc("prune_hazard_photo_reservations", {
            p_photo_ids: [],
          })
        ).error,
      );
    });

    test("confirms once per request, resolves, and refuses reopening", async () => {
      const id = await site();
      const report = ok(await submit(id)).report;
      const request = randomUUID();
      const response = ok(
        await checkin(report.id, true, { p_request_id: request }),
      );
      assert.equal(response.report.confirmations, 2);
      assert.deepEqual(
        ok(await checkin(report.id, true, { p_request_id: request })),
        response,
      );
      assert.equal(
        ok(await checkin(report.id, false)).report.status,
        "resolved",
      );
      assert.ok((await checkin(report.id)).error);
      assert.notEqual(ok(await submit(id)).report.id, report.id);
    });

    test("coordinates simultaneous resolution and confirmation without reopening", async () => {
      const id = await site();
      const report = ok(await submit(id)).report;
      const results = await Promise.all([
        checkin(report.id, false),
        checkin(report.id, true),
      ]);
      assert.equal(results[0].error, null);
      const [final] = ok(
        await clients.crew
          .from("hazard_reports")
          .select("*")
          .eq("id", report.id),
      );
      assert.equal(final.status, "resolved");
    });

    test("an older transaction cannot move the confirmation timestamp backward", async () => {
      const id = await site();
      const connection = await db.connect();
      try {
        await connection.query("begin");
        await connection.query(
          "select set_config('request.jwt.claims',$1,true)",
          [JSON.stringify({ sub: users.crew, role: "authenticated" })],
        );
        await connection.query("set local role authenticated");
        const report = ok(await submit(id)).report;
        const {
          rows: [row],
        } = await connection.query(
          "select public.checkin_hazard_report($1,$2,true) as result",
          [randomUUID(), report.id],
        );
        assert.ok(
          new Date(row.result.report.last_confirmed_at) >=
            new Date(report.last_confirmed_at),
        );
        assert.ok(
          new Date(row.result.report.last_confirmed_at) >=
            new Date(report.created_at),
        );
        await connection.query("commit");
      } finally {
        await connection.query("rollback");
        connection.release();
      }
    });

    test("calculates decay, caps, wildlife scoring and site radius", async () => {
      const id = await site();
      const report = ok(
        await submit(id, { p_type: "wildlife", p_severity: 3 }),
      ).report;
      await age(report.id, 24);
      const [metrics] = ok(
        await clients.crew.rpc("get_site_crew_metrics", { p_site_id: id }),
      );
      assert.equal(Number(metrics.crew_risk_term), 0.5);
      assert.equal(Number(metrics.wildlife_subscore), 5);
      ok(await submit(id, { p_type: "downed_line", p_severity: 3 }));
      ok(await submit(id, { p_type: "washout", p_severity: 3 }));
      assert.equal(
        Number(
          ok(
            await clients.crew.rpc("get_site_crew_metrics", { p_site_id: id }),
          )[0].crew_risk_term,
        ),
        2,
      );
      ok(
        await submit(id, {
          p_type: "wildlife",
          p_severity: 3,
          p_lat: lat + 0.002,
        }),
      );
      assert.equal(
        Number(
          ok(
            await clients.crew.rpc("get_site_crew_metrics", { p_site_id: id }),
          )[0].wildlife_subscore,
        ),
        10,
      );
      const narrow = await site(["crew"], 100);
      ok(await submit(narrow, { p_lat: lat + 0.002 }));
      assert.equal(
        ok(
          await clients.crew.rpc("get_site_crew_metrics", {
            p_site_id: narrow,
          }),
        )[0].open_report_count,
        0,
      );
    });

    test("exposes scoped spatial history and allows trusted scoring workers", async () => {
      const id = await site();
      const report = ok(await submit(id)).report;
      const feed = ok(
        await admin
          .from("crew_observation_feed")
          .select("*")
          .eq("report_id", report.id),
      );
      assert.equal(feed.length, 1);
      assert.equal(feed[0].site_id, id);
      assert.equal(feed[0].latitude, lat);
      assert.equal(feed[0].longitude, lon);
      assert.deepEqual(
        ok(
          await clients.other
            .from("crew_observation_feed")
            .select("*")
            .eq("report_id", report.id),
        ),
        [],
      );
      assert.equal(
        ok(await admin.rpc("get_site_crew_metrics", { p_site_id: id }))[0]
          .open_report_count,
        1,
      );
    });

    test("excludes 48-hour-old hazards immediately and persists expiry once", async () => {
      const id = await site();
      const report = ok(await submit(id, { p_type: "wildlife" })).report;
      await age(report.id, 48);
      assert.equal(
        ok(
          await clients.crew.rpc("get_site_crew_metrics", { p_site_id: id }),
        )[0].open_report_count,
        0,
      );
      assert.equal(
        ok(
          await clients.crew
            .from("crew_hazard_feed")
            .select("*")
            .eq("id", report.id),
        )[0].is_active,
        false,
      );
      assert.ok((await checkin(report.id)).error);
      ok(await admin.rpc("run_hazard_maintenance"));
      ok(await admin.rpc("run_hazard_maintenance"));
      const observations = ok(
        await clients.crew
          .from("hazard_observations")
          .select("*")
          .eq("report_id", report.id)
          .eq("action", "expired"),
      );
      assert.equal(observations.length, 1);
      assert.equal(observations[0].actor_id, null);
    });

    test("creates recipient-scoped check-in reminders idempotently and completes them", async () => {
      const id = await site();
      const report = ok(await submit(id)).report;
      await age(report.id, 13);
      ok(await admin.rpc("run_hazard_maintenance"));
      ok(await admin.rpc("run_hazard_maintenance"));
      const tasks = ok(
        await clients.crew
          .from("hazard_checkin_tasks")
          .select("*")
          .eq("report_id", report.id),
      );
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].user_id, users.crew);
      assert.deepEqual(
        ok(
          await clients.other
            .from("hazard_checkin_tasks")
            .select("*")
            .eq("report_id", report.id),
        ),
        [],
      );
      ok(await checkin(report.id));
      assert.ok(
        ok(
          await clients.crew
            .from("hazard_checkin_tasks")
            .select("*")
            .eq("report_id", report.id),
        )[0].completed_at,
      );
      const { rows } = await db.query(
        "select count(*)::int as count from cron.job where jobname='crew-hazard-maintenance' and active",
      );
      assert.equal(rows[0].count, 1);
    });

    test("pg_cron actually executes the maintenance job without application credentials", async () => {
      const id = await site();
      const report = ok(await submit(id)).report;
      await age(report.id, 49);
      const {
        rows: [job],
      } = await db.query(
        "select cron.schedule($1,'1 second','select public.run_hazard_maintenance()') as id",
        [`crew-test-${randomUUID()}`],
      );
      try {
        const deadline = Date.now() + 10000;
        let status;
        while (Date.now() < deadline) {
          const {
            rows: [row],
          } = await db.query(
            "select status from public.hazard_reports where id=$1",
            [report.id],
          );
          status = row.status;
          if (status === "resolved") break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.equal(
          status,
          "resolved",
          "pg_cron did not resolve the expired report",
        );
      } finally {
        await db.query("select cron.unschedule($1::bigint)", [job.id]);
      }
    });

    test("reserves, uploads and attaches a private photo with team-only access", async () => {
      const id = await site();
      const photo = await reserve(id);
      ok(
        await clients.crew.storage
          .from("hazard-photos")
          .upload(photo.object_path, png, { contentType: "image/png" }),
      );
      const report = ok(await submit(id, { p_photo_id: photo.id })).report;
      assert.equal(
        ok(
          await clients.crew
            .from("hazard_photos")
            .select("*")
            .eq("id", photo.id),
        ).length,
        1,
      );
      const signed = ok(
        await clients.supervisor.storage
          .from("hazard-photos")
          .createSignedUrl(photo.object_path, 30),
      );
      assert.equal((await fetch(signed.signedUrl)).status, 200);
      assert.ok(
        (
          await clients.other.storage
            .from("hazard-photos")
            .createSignedUrl(photo.object_path, 30)
        ).error,
      );
      assert.notEqual(
        (
          await fetch(
            `${config.API_URL}/storage/v1/object/public/hazard-photos/${photo.object_path}`,
          )
        ).status,
        200,
      );
      assert.ok(
        (
          await clients.crew.storage
            .from("hazard-photos")
            .update(photo.object_path, png, { contentType: "image/png" })
        ).error,
      );
      assert.ok(
        (await submit(id, { p_photo_id: photo.id, p_lat: lat + 0.003 })).error,
      );
      assert.ok(report.id);
    });

    test("rejects missing uploads, unauthorized reservations, arbitrary paths, MIME types and oversized files", async () => {
      const id = await site();
      const photo = await reserve(id);
      assert.ok((await submit(id, { p_photo_id: photo.id })).error);
      assert.ok(
        (
          await clients.other.rpc("reserve_hazard_photo", {
            p_photo_id: randomUUID(),
            p_site_id: id,
            p_content_type: "image/png",
          })
        ).error,
      );
      assert.ok(
        (
          await clients.crew.rpc("reserve_hazard_photo", {
            p_photo_id: randomUUID(),
            p_site_id: id,
            p_content_type: "text/html",
          })
        ).error,
      );
      assert.ok(
        (
          await clients.crew.storage
            .from("hazard-photos")
            .upload(`${id}/arbitrary.png`, png, { contentType: "image/png" })
        ).error,
      );
      assert.ok(
        (
          await clients.crew.storage
            .from("hazard-photos")
            .upload(photo.object_path, "<script>", { contentType: "text/html" })
        ).error,
      );
      assert.ok(
        (
          await clients.crew.storage
            .from("hazard-photos")
            .upload(photo.object_path, Buffer.alloc(5242881), {
              contentType: "image/png",
            })
        ).error,
      );
    });

    test("prunes abandoned reservations only after Storage API removal", async () => {
      const id = await site();
      const photo = await reserve(id);
      ok(
        await clients.crew.storage
          .from("hazard-photos")
          .upload(photo.object_path, png, { contentType: "image/png" }),
      );
      await db.query(
        "update public.hazard_photos set created_at=now()-interval '2 hours' where id=$1",
        [photo.id],
      );
      assert.equal(
        ok(
          await admin.rpc("prune_hazard_photo_reservations", {
            p_photo_ids: [photo.id],
          }),
        ),
        0,
      );
      ok(await admin.storage.from("hazard-photos").remove([photo.object_path]));
      assert.equal(
        ok(
          await admin.rpc("prune_hazard_photo_reservations", {
            p_photo_ids: [photo.id],
          }),
        ),
        1,
      );
    });

    test("delivers authorized Realtime updates to another team client", async () => {
      const id = await site();
      let resolveEvent;
      const event = new Promise((resolve) => {
        resolveEvent = resolve;
      });
      let resolveReady;
      const ready = new Promise((resolve) => {
        resolveReady = resolve;
      });
      const channel = clients.supervisor
        .channel(`hazard-test-${randomUUID()}`)
        .on("system", {}, (payload) => {
          if (
            payload.extension === "postgres_changes" &&
            payload.status === "ok"
          )
            resolveReady();
        })
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "hazard_reports",
            filter: `site_id=eq.${id}`,
          },
          resolveEvent,
        );
      channels.push(channel);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Realtime subscription timeout")),
          15000,
        );
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            clearTimeout(timer);
            resolve();
          }
          if (status === "CHANNEL_ERROR") {
            clearTimeout(timer);
            reject(new Error("Realtime channel failed"));
          }
        });
      });
      let readyTimer;
      await Promise.race([
        ready,
        new Promise((_, reject) => {
          readyTimer = setTimeout(
            () => reject(new Error("Database changes did not become ready")),
            20000,
          );
        }),
      ]).finally(() => clearTimeout(readyTimer));
      const report = ok(await submit(id)).report;
      let timer;
      const payload = await Promise.race([
        event,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Realtime event timeout")),
            15000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      assert.equal(payload.new.id, report.id);
      await channel.unsubscribe();
    });
  },
);
