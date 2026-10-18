/*
 * Dev-only in-browser mock of the Supabase HTTP + realtime API, for iterating
 * on the UI without Docker. Started by `npm run dev:design`; never bundled into
 * production builds (see src/dev/installMock.ts).
 *
 * Query flags: ?latency=1500 slows every response (to design busy states) and
 * ?fail makes report submissions and check-ins fail (to design error states).
 */

import { offsetPoint } from "../lib/geo";
import { handleSafety } from "./mockSafety";

type Row = Record<string, unknown>;

const PASSWORD = "CrewDemo123!";
/** Fictional plants at plausible Florida industrial and utility locations. */
const sites = [
  {
    id: "site-north",
    name: "North Plant · Demo",
    latitude: 29.652,
    longitude: -82.325,
  },
  {
    id: "site-south",
    name: "South Plant · Demo",
    latitude: 29.6296,
    longitude: -82.3498,
  },
  {
    id: "site-tampa",
    name: "Tampa Bay Terminal · Demo",
    latitude: 27.9335,
    longitude: -82.4385,
  },
  {
    id: "site-jax",
    name: "Jacksonville Terminal · Demo",
    latitude: 30.356,
    longitude: -81.629,
  },
  {
    id: "site-manatee",
    name: "Port Manatee Terminal · Demo",
    latitude: 27.637,
    longitude: -82.56,
  },
  {
    id: "site-everglades",
    name: "Port Everglades Tank Farm · Demo",
    latitude: 26.088,
    longitude: -80.127,
  },
  // A real plant, so the Next-day report tab has a sample report to show (public/reports/621).
  {
    id: "site-turkey-point",
    name: "Turkey Point · Report demo",
    latitude: 25.4356,
    longitude: -80.3308,
    eia_plant_id: "621",
  },
];
const accounts: Record<string, string[]> = {
  "crew@planit.local": ["site-north"],
  "other@planit.local": ["site-south"],
  "supervisor@planit.local": sites.map((site) => site.id),
  "outsider@planit.local": [],
  // The dashboard's roster people can sign in; two more accounts have no site yet.
  "jordan@planit.local": sites.map((site) => site.id),
  "sam@planit.local": sites.map((site) => site.id),
  "taylor.kim@example.com": [],
  "riley.chen@example.com": [],
};
/** Supervisors supervise every site they belong to; everyone else is crew. */
const isSupervisorAt = (email: string, siteId: string) =>
  supervisors.has(email) && accounts[email]?.includes(siteId) === true;

type Report = {
  id: string;
  site_id: string;
  type: string;
  severity: number;
  status: "open" | "resolved" | "expired";
  confirmations: number;
  last_confirmed_at: string;
  latitude: number;
  longitude: number;
  is_active: boolean;
};
type Observation = {
  id: string;
  report_id: string;
  action: string;
  severity: number;
  created_at: string;
};
type Photo = {
  id: string;
  site_id: string;
  object_path: string;
  observation_id?: string;
};

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60000).toISOString();
type Seed = [
  type: string,
  severity: number,
  confirmations: number,
  ageMinutes: number,
  metersNorth: number,
  metersEast: number,
  active?: boolean,
];

/** Places each report by metres from its site's center: inside the 300 m ring,
 * out toward the 1200 m × 800 m edge, and a few just beyond it ("near" the site). */
function seedSite(siteId: string, entries: Seed[]): Report[] {
  const site = sites.find((candidate) => candidate.id === siteId)!;
  return entries.map(
    (
      [type, severity, confirmations, age, north, east, active = true],
      index,
    ) => {
      const point = offsetPoint(site, north, east);
      return {
        id: `r-${siteId}-${index}`,
        site_id: siteId,
        type,
        severity,
        confirmations,
        latitude: point.latitude,
        longitude: point.longitude,
        last_confirmed_at: minutesAgo(age),
        status: active ? "open" : "resolved",
        is_active: active,
      } satisfies Report;
    },
  );
}

const reports: Report[] = [
  ...seedSite("site-north", [
    ["downed_line", 3, 4, 20, 90, -140],
    ["wildlife", 2, 1, 180, -60, 220],
    ["debris", 1, 2, 50, 30, 45],
    ["debris", 2, 3, 95, 210, 310],
    ["washout", 3, 2, 240, -280, -120],
    ["other", 1, 1, 400, 340, -480],
    ["wildlife", 1, 1, 1000, -20, -560],
    ["washout", 2, 2, 1560, -200, 410, false],
    ["downed_line", 2, 1, 70, 520, 140],
  ]),
  ...seedSite("site-south", [
    ["debris", 2, 1, 35, 40, 70],
    ["wildlife", 3, 3, 15, -120, -90],
    ["washout", 2, 2, 160, 180, -260],
    ["other", 1, 1, 600, -310, 380],
    ["downed_line", 3, 5, 8, 260, 120],
    ["debris", 1, 2, 2000, -40, 20, false],
  ]),
  ...seedSite("site-tampa", [
    ["washout", 3, 4, 25, 60, -110],
    ["debris", 2, 2, 90, -140, 200],
    ["downed_line", 2, 1, 130, 230, 60],
    ["wildlife", 1, 1, 310, -250, -300],
    ["other", 2, 2, 55, 20, 420],
    ["debris", 1, 1, 2400, -90, -40, false],
  ]),
  ...seedSite("site-jax", [
    ["debris", 3, 3, 12, -80, 130],
    ["other", 2, 2, 75, 150, -200],
    ["wildlife", 2, 1, 200, 310, 330],
    ["downed_line", 1, 1, 420, -330, -380],
    ["washout", 2, 2, 45, 10, -60],
  ]),
  ...seedSite("site-manatee", [
    ["downed_line", 3, 3, 14, -60, 150],
    ["debris", 2, 2, 85, 90, -170],
    ["washout", 2, 1, 220, -150, -260],
    ["wildlife", 1, 1, 540, 240, 330],
    ["other", 3, 2, 30, 20, 60],
    ["debris", 1, 1, 1900, -200, 120, false],
  ]),
  ...seedSite("site-everglades", [
    ["wildlife", 3, 6, 18, 70, 90],
    ["downed_line", 3, 2, 40, -190, -150],
    ["debris", 2, 1, 110, 240, -280],
    ["washout", 1, 1, 500, -310, 410],
    ["other", 2, 1, 65, 120, -30],
    ["wildlife", 2, 2, 1700, 30, 260, false],
  ]),
];
const observations: Observation[] = reports.map((report) => ({
  id: `o-${report.id}`,
  report_id: report.id,
  action: report.is_active ? "created" : "resolved",
  severity: report.severity,
  created_at: report.last_confirmed_at,
}));
const photos: Photo[] = [];
let tasks = [
  { id: "t-north", report_id: "r-site-north-0" },
  { id: "t-south", report_id: "r-site-south-4" },
];

const params = new URLSearchParams(location.search);
const latency = Number(params.get("latency") ?? 150);
const failWrites = params.has("fail");
// ?break=alerts, or window.__mockFlags.breakAlerts at runtime, makes alert reads fail.
// Created on first use, not at import, so importing this module has no side effects.
type Flags = { breakAlerts: boolean; breakCrew: boolean };
function flags(): Flags {
  const w = window as unknown as { __mockFlags?: Flags };
  return (w.__mockFlags ??= {
    breakAlerts: params.get("break") === "alerts",
    // ?break=crew pretends the crew-assignment migration has not been applied.
    breakCrew: params.get("break") === "crew",
  });
}

/* ---------- monitoring: alerts, site risk, briefings ---------- */

type MockAlert = {
  id: string;
  site_id: string;
  kind: string;
  level: string;
  status: "active" | "cleared";
  payload: Row;
  dedup_key: string;
  created_at: string;
  cleared_at: string | null;
  /** Who can see it; null means everyone on the site. */
  target_user_ids?: string[] | null;
};
const secondsFromNow = (seconds: number) =>
  new Date(Date.now() + seconds * 1000).toISOString();
// ?clear=8 makes the lightning countdown end in 8 seconds, to design that state.
const lightningClearIn = Number(params.get("clear") ?? 24 * 60 + 31);
function mockAlert(
  siteId: string,
  kind: string,
  level: string,
  payload: Row,
  ageMinutes: number,
): MockAlert {
  return {
    id: `a-${siteId}-${kind}`,
    site_id: siteId,
    kind,
    level,
    status: "active",
    payload,
    dedup_key: `${kind}:${siteId}`,
    created_at: minutesAgo(ageMinutes),
    cleared_at: null,
  };
}
const alerts: MockAlert[] = [
  mockAlert(
    "site-north",
    "lightning",
    "stop_work",
    {
      last_strike_at: minutesAgo(6),
      distance_mi: 6.2,
      clear_at: secondsFromNow(lightningClearIn),
    },
    6,
  ),
  mockAlert(
    "site-north",
    "heat",
    "warning",
    { wbgt_f: 87.4, tier: "danger, limit heavy work" },
    95,
  ),
  mockAlert(
    "site-south",
    "flood",
    "warning",
    {
      rain_overnight_mm: 31,
      gauge_stage_ft: 11.8,
      flood_zone: "AE",
      river_distance_m: 2400,
      nws_flood_warning: false,
    },
    240,
  ),
  mockAlert(
    "site-tampa",
    "wildfire",
    "warning",
    {
      nearest_fire_mi: 18.4,
      fires_within_25mi: 2,
      smoke_note: "Smoke likely; check air quality before heavy work.",
    },
    130,
  ),
  mockAlert(
    "site-jax",
    "other",
    "warning",
    { nws_alert_severity: 3, wind_gust_mph: 44 },
    50,
  ),
  mockAlert(
    "site-everglades",
    "heat",
    "info",
    { wbgt_f: 82.4, tier: "caution" },
    300,
  ),
];
const alertAcks = new Set<string>(); // `${userId}|${alertId}`

function base64url(value: object): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function makeSession(email: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: `user-${email}`,
    aud: "authenticated",
    role: "authenticated",
    email,
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  return {
    access_token: `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url({
      sub: user.id,
      email,
      role: "authenticated",
      exp: expiresAt,
    })}.mock`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: `mock-refresh:${email}`,
    user,
  };
}
function emailFromAuthorization(headers: Headers): string | undefined {
  const token = headers.get("authorization")?.replace(/^Bearer /i, "");
  const payload = token?.split(".")[1];
  if (!payload) return undefined;
  try {
    const decoded = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    );
    return typeof decoded.email === "string" ? decoded.email : undefined;
  } catch {
    return undefined;
  }
}

function metersBetween(a: Report, latitude: number, longitude: number): number {
  const dy = (latitude - a.latitude) * 111320;
  const dx =
    (longitude - a.longitude) * 111320 * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(dx, dy);
}
function log(report: Report, action: string, severity = report.severity) {
  observations.unshift({
    id: crypto.randomUUID(),
    report_id: report.id,
    action,
    severity,
    created_at: new Date().toISOString(),
  });
}

/* ---------- realtime ---------- */

type Channel = { topic: string; joinRef: string | null; ids: number[] };
const channels = new Set<Channel>();
const sockets = new Set<MockSocket>();

function notifyChange() {
  for (const socket of sockets)
    for (const channel of socket.channels) {
      socket.push([
        channel.joinRef,
        null,
        channel.topic,
        "postgres_changes",
        {
          ids: channel.ids,
          data: {
            schema: "public",
            table: "hazard_reports",
            commit_timestamp: new Date().toISOString(),
            type: "UPDATE",
            columns: [],
            record: {},
            old_record: {},
            errors: null,
          },
        },
      ]);
    }
}

class MockSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  binaryType = "arraybuffer";
  protocol = "";
  extensions = "";
  bufferedAmount = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  channels = new Set<Channel>();

  constructor(readonly url: string) {
    super();
    sockets.add(this);
    setTimeout(() => {
      this.readyState = 1;
      this.emit("open", new Event("open"));
    }, 50);
  }

  private emit(type: "open" | "message" | "close", event: Event) {
    this.dispatchEvent(event);
    const handler = this[`on${type}` as "onopen" | "onmessage" | "onclose"] as
      ((event: Event) => void) | null;
    handler?.call(this, event);
  }

  push(message: unknown[]) {
    if (this.readyState !== 1) return;
    this.emit(
      "message",
      new MessageEvent("message", { data: JSON.stringify(message) }),
    );
  }

  send(data: string) {
    if (typeof data !== "string") return;
    const [joinRef, ref, topic, event, payload] = JSON.parse(data) as [
      string | null,
      string | null,
      string,
      string,
      { config?: { postgres_changes?: Row[] } },
    ];
    if (event === "heartbeat") {
      this.push([
        null,
        ref,
        "phoenix",
        "phx_reply",
        { status: "ok", response: {} },
      ]);
    } else if (event === "phx_join") {
      const bindings = (payload.config?.postgres_changes ?? []).map(
        (binding, index) => ({
          ...binding,
          id: index + 1,
        }),
      );
      const channel = {
        topic,
        joinRef,
        ids: bindings.map((binding) => binding.id as number),
      };
      this.channels.add(channel);
      channels.add(channel);
      setTimeout(() => {
        this.push([
          joinRef,
          ref,
          topic,
          "phx_reply",
          { status: "ok", response: { postgres_changes: bindings } },
        ]);
        setTimeout(
          () =>
            this.push([
              joinRef,
              null,
              topic,
              "system",
              {
                extension: "postgres_changes",
                status: "ok",
                message: "Subscribed to PostgreSQL",
                channel: topic,
              },
            ]),
          30,
        );
      }, 20);
    } else if (event === "phx_leave") {
      for (const channel of this.channels)
        if (channel.topic === topic) this.channels.delete(channel);
      this.push([
        joinRef,
        ref,
        topic,
        "phx_reply",
        { status: "ok", response: {} },
      ]);
      this.push([joinRef, null, topic, "phx_close", {}]);
    }
  }

  close(code = 1000, reason = "") {
    this.readyState = 3;
    sockets.delete(this);
    this.emit(
      "close",
      new CloseEvent("close", { code, reason, wasClean: true }),
    );
  }
}

/* ---------- HTTP ---------- */

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function respond(body: unknown, status = 200): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
const apiError = (message: string, status = 400) =>
  respond({ message, code: "MOCK", details: null, hint: null }, status);
const filterValue = (url: URL, column: string) =>
  url.searchParams.get(column)?.replace(/^eq\./, "");

// --- Monitoring, crew roster, push and briefing review (design mode only) ---
const supervisors = new Set(["supervisor@planit.local"]);
/** What the dashboard's roster shows about each person who shares a location. */
const crewProfiles: Record<
  string,
  {
    name: string;
    place?: [north: number, east: number];
    age: number;
    push: boolean;
  }
> = {
  "crew@planit.local": {
    name: "Alex Rivera",
    place: [120, -80],
    age: 2,
    push: true,
  },
  "jordan@planit.local": {
    name: "Jordan Lee",
    place: [-200, 340],
    age: 18,
    push: false,
  },
  "sam@planit.local": { name: "Sam Okafor", age: 0, push: true },
};
const mockCrew = (siteId: string) => {
  const site = sites.find((candidate) => candidate.id === siteId)!;
  return Object.keys(accounts)
    .filter(
      (email) => accounts[email].includes(siteId) && !supervisors.has(email),
    )
    .map((email) => {
      const profile = crewProfiles[email];
      const where = profile?.place ? offsetPoint(site, ...profile.place) : null;
      return {
        user_id: `user-${email}`,
        name: profile?.name ?? email.split("@")[0],
        email,
        latitude: where?.latitude ?? null,
        longitude: where?.longitude ?? null,
        age: profile?.age ?? 0,
        push: profile?.push ?? false,
      };
    });
};
type MockDraft = {
  site_id: string;
  for_date: string;
  status: "generating" | "draft" | "sent";
  source: "gemini" | "rules";
  updated_at: string;
  sent_at: string | null;
  content: Record<string, unknown>;
};
const drafts = new Map<string, MockDraft>();
function mockDraft(
  siteId: string,
  status: MockDraft["status"] = "draft",
): MockDraft {
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const blocked = hour >= 13 && hour <= 15;
    return {
      hour,
      wbgt: blocked ? 89 : 80,
      gust: 12,
      pop: blocked ? 70 : 10,
      mm: 0,
      safe: !blocked,
      blocked_by: blocked ? ["storms"] : [],
    };
  });
  return {
    site_id: siteId,
    for_date: date,
    status,
    source: "gemini",
    updated_at: new Date().toISOString(),
    sent_at: null,
    content: {
      work_window: { start: "07:00", end: "13:00" },
      summary:
        "Start early and wrap up by 1 PM. Afternoon storms are likely from 1 to 4 PM.",
      reasons: ["Storm chance reaches 70% mid-afternoon."],
      context: {
        traffic:
          "Lane closure on the main access road until 9 AM; allow extra time for deliveries.",
        school:
          "Elementary school nearby is in session; expect bus traffic 7:30 to 8:15 AM and 3 PM.",
        wildlife:
          "Gopher tortoises and snakes are active on warm mornings; watch the access road verges.",
      },
      hourly,
      neighbors: [
        {
          name: "Neighbor Plant · Demo",
          distance_km: 14.2,
          risk_tomorrow: 6.5,
          driver: "weather subscore 6.5",
        },
      ],
    },
  };
}

async function handle(
  request: { method: string; url: URL; headers: Headers; body: unknown },
  path: string,
): Promise<Response> {
  const { method, url, headers } = request;
  const body = (request.body ?? {}) as Row;
  const email = emailFromAuthorization(headers);

  if (path === "/auth/v1/token") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "refresh_token") {
      const refreshed = String(body.refresh_token ?? "").replace(
        "mock-refresh:",
        "",
      );
      return refreshed in accounts
        ? respond(makeSession(refreshed))
        : apiError("Invalid refresh token", 400);
    }
    const attempted = String(body.email ?? "").toLowerCase();
    if (!(attempted in accounts) || body.password !== PASSWORD)
      return respond(
        {
          code: 400,
          error_code: "invalid_credentials",
          msg: "Invalid login credentials",
        },
        400,
      );
    return respond(makeSession(attempted));
  }
  if (path === "/auth/v1/user")
    return email
      ? respond(makeSession(email).user)
      : apiError("Not signed in", 401);
  if (path === "/auth/v1/logout") return respond(null, 204);
  if (!email || !(email in accounts)) return apiError("JWT required", 401);

  const safetyResponse = handleSafety(
    path,
    body,
    email,
    accounts[email],
    supervisors.has(email),
    failWrites,
  );
  if (safetyResponse) return safetyResponse;

  if (path === "/rest/v1/sites")
    return respond(
      sites
        .filter((site) => accounts[email].includes(site.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  if (path === "/rest/v1/crew_hazard_feed") {
    const siteId = filterValue(url, "site_id");
    return respond(
      reports
        .filter(
          (report) =>
            report.site_id === siteId &&
            accounts[email].includes(report.site_id),
        )
        .sort((a, b) => b.last_confirmed_at.localeCompare(a.last_confirmed_at)),
    );
  }
  if (path === "/rest/v1/rpc/get_site_crew_metrics") {
    const open = reports.filter(
      (report) => report.site_id === body.p_site_id && report.is_active,
    );
    const wildlife = open.filter((report) => report.type === "wildlife");
    return respond([
      {
        open_report_count: open.length,
        crew_risk_term: Math.min(
          2,
          open.reduce((sum, report) => sum + report.severity, 0) * 0.14,
        ),
        wildlife_subscore: Math.min(
          10,
          wildlife.reduce((sum, report) => sum + report.severity * 1.6, 0),
        ),
      },
    ]);
  }
  if (path === "/rest/v1/hazard_checkin_tasks") return respond(tasks);
  if (path === "/rest/v1/hazard_observations") {
    const reportId = filterValue(url, "report_id");
    return respond(
      observations.filter((observation) => observation.report_id === reportId),
    );
  }
  if (path === "/rest/v1/hazard_photos") {
    const ids = (url.searchParams.get("observation_id") ?? "")
      .replace(/^in\.\(|\)$/g, "")
      .split(",");
    return respond(
      photos.filter(
        (photo) => photo.observation_id && ids.includes(photo.observation_id),
      ),
    );
  }
  if (path === "/rest/v1/rpc/reserve_hazard_photo") {
    const photo: Photo = {
      id: String(body.p_photo_id),
      site_id: String(body.p_site_id),
      object_path: `${body.p_site_id}/mock/${body.p_photo_id}.png`,
    };
    photos.push(photo);
    return respond(photo);
  }
  if (path.startsWith("/storage/v1/object/hazard-photos/"))
    return respond({ Key: "hazard-photos/mock", Id: "mock" });
  if (path.startsWith("/storage/v1/object/sign/hazard-photos/"))
    return respond({
      signedURL: "/object/sign/hazard-photos/mock.svg?token=mock",
    });
  if (method === "DELETE" && path.startsWith("/storage/")) return respond([]);

  if (path === "/rest/v1/rpc/submit_hazard_report") {
    if (failWrites) return apiError("Simulated failure (?fail)", 500);
    const lat = Number(body.p_lat);
    const lon = Number(body.p_lon);
    const existing = reports.find(
      (report) =>
        report.site_id === body.p_site_id &&
        report.is_active &&
        report.type === body.p_type &&
        metersBetween(report, lat, lon) <= 100,
    );
    let report: Report;
    let outcome: "created" | "merged";
    if (existing) {
      existing.confirmations++;
      existing.last_confirmed_at = new Date().toISOString();
      report = existing;
      outcome = "merged";
      log(report, "confirmed", Number(body.p_severity));
    } else {
      report = {
        id: crypto.randomUUID(),
        site_id: String(body.p_site_id),
        type: String(body.p_type),
        severity: Number(body.p_severity),
        status: "open",
        confirmations: 1,
        last_confirmed_at: new Date().toISOString(),
        latitude: lat,
        longitude: lon,
        is_active: true,
      };
      reports.unshift(report);
      outcome = "created";
      log(report, "created");
    }
    const photo = photos.find((candidate) => candidate.id === body.p_photo_id);
    if (photo) photo.observation_id = observations[0].id;
    notifyChange();
    return respond({ outcome, report });
  }
  if (path === "/rest/v1/rpc/checkin_hazard_report") {
    if (failWrites) return apiError("Simulated failure (?fail)", 500);
    const report = reports.find(
      (candidate) => candidate.id === body.p_report_id,
    );
    if (!report) return apiError("Report not found", 404);
    if (body.p_still_there) {
      report.confirmations++;
      report.last_confirmed_at = new Date().toISOString();
      log(report, "confirmed");
    } else {
      report.is_active = false;
      report.status = "resolved";
      log(report, "resolved");
    }
    tasks = tasks.filter((task) => task.report_id !== report.id);
    notifyChange();
    return respond(null);
  }
  const siteParam = String(body.p_site_id ?? filterValue(url, "site_id") ?? "");
  const memberOf = accounts[email].includes(siteParam);
  const isSupervisor = memberOf && supervisors.has(email);
  // ?break=crew pretends the crew-assignment migration has not been applied.
  if (
    flags().breakCrew &&
    /\/rpc\/(assign_site_member|unassign_site_member)$/.test(path)
  )
    return respond(
      {
        code: "PGRST202",
        message: `Could not find the function public.${path.split("/").pop()} in the schema cache`,
        details: null,
        hint: null,
      },
      404,
    );
  if (path === "/rest/v1/rpc/assign_site_member") {
    if (!isSupervisor) return apiError("Supervisor role required", 403);
    if (failWrites) return apiError("Simulated failure (?fail)", 500);
    const wanted = String(body.p_email ?? "")
      .trim()
      .toLowerCase();
    if (!wanted)
      return apiError("Enter the email address of the person to add.", 400);
    const address = Object.keys(accounts).find(
      (candidate) => candidate.toLowerCase() === wanted,
    );
    if (!address) return apiError("No account uses that email address.", 400);
    if (accounts[address].includes(siteParam))
      return respond({
        ok: true,
        outcome: "already_member",
        user_id: `user-${address}`,
        email: address,
        role: supervisors.has(address) ? "supervisor" : "crew",
      });
    accounts[address].push(siteParam);
    return respond({
      ok: true,
      outcome: "assigned",
      user_id: `user-${address}`,
      email: address,
      role: "crew",
    });
  }
  if (path === "/rest/v1/rpc/unassign_site_member") {
    if (!isSupervisor) return apiError("Supervisor role required", 403);
    if (failWrites) return apiError("Simulated failure (?fail)", 500);
    const address = Object.keys(accounts).find(
      (candidate) => `user-${candidate}` === body.p_user_id,
    );
    if (!address || !accounts[address].includes(siteParam))
      return respond({ ok: true, removed: false });
    if (supervisors.has(address))
      return apiError("Supervisors cannot be removed here.", 403);
    accounts[address] = accounts[address].filter((id) => id !== siteParam);
    return respond({ ok: true, removed: true });
  }
  if (path === "/rest/v1/alert_acks") {
    const ids = (url.searchParams.get("alert_id") ?? "")
      .replace(/^in\.\(|\)$/g, "")
      .split(",");
    const userId = filterValue(url, "user_id") ?? "";
    return respond(
      ids
        .filter((id) => alertAcks.has(`${userId}|${id}`))
        .map((id) => ({ alert_id: id })),
    );
  }
  if (path === "/rest/v1/rpc/acknowledge_alert") {
    if (failWrites) return apiError("Simulated failure (?fail)", 500);
    const alert = alerts.find((a) => a.id === body.p_alert_id);
    if (!alert || !accounts[email].includes(alert.site_id))
      return apiError("Unknown alert", 400);
    alertAcks.add(`user-${email}|${alert.id}`);
    return respond({ ok: true, acknowledged_at: new Date().toISOString() });
  }
  if (path === "/rest/v1/site_memberships")
    return respond(
      accounts[email].map((site_id) => ({
        site_id,
        role: supervisors.has(email) ? "supervisor" : "crew",
      })),
    );
  if (path === "/rest/v1/site_overview")
    return respond(
      memberOf
        ? [
            {
              site_id: siteParam,
              risk_now: 5.2,
              risk_tomorrow: 6.5,
              top_driver: "heat subscore 5",
              active_alert_count: 1,
              subscores: {
                heat: 5,
                weather: 3,
                lightning: 0,
                flood: 1.5,
                wildfire: 0,
                soil: 2,
                wildlife: 2,
              },
            },
          ]
        : [],
    );
  if (path === "/rest/v1/alerts") {
    if (flags().breakAlerts)
      return apiError("Simulated outage (?break=alerts)", 503);
    return respond(
      memberOf
        ? alerts
            .filter(
              (a) =>
                a.site_id === siteParam &&
                a.status === "active" &&
                (isSupervisor ||
                  !a.target_user_ids ||
                  a.target_user_ids.includes(`user-${email}`)),
            )
            .map(({ id, kind, level, created_at, payload }) => ({
              id,
              kind,
              level,
              created_at,
              payload,
            }))
        : [],
    );
  }
  if (path === "/rest/v1/lightning_state") {
    if (flags().breakAlerts)
      return apiError("Simulated outage (?break=alerts)", 503);
    // ?clear=N makes the stop-work countdown end in N seconds (it runs 30 minutes from the strike).
    const strike = alerts.find(
      (a) =>
        a.site_id === siteParam &&
        a.kind === "lightning" &&
        a.status === "active",
    );
    return respond(
      memberOf
        ? [
            {
              site_id: siteParam,
              status: strike ? "stop_work" : "clear",
              last_strike_at: strike
                ? new Date(
                    Date.now() + lightningClearIn * 1000 - 30 * 60 * 1000,
                  ).toISOString()
                : null,
              last_strike_distance_m: strike
                ? Math.round(Number(strike.payload.distance_mi) * 1609.344)
                : null,
            },
          ]
        : [],
    );
  }
  if (path === "/rest/v1/briefing_drafts") {
    const draft = drafts.get(siteParam);
    return respond(
      memberOf && draft && (isSupervisor || draft.status === "sent")
        ? [draft]
        : [],
    );
  }
  if (path === "/rest/v1/hazard_evidence") {
    return respond(
      memberOf
        ? [
            {
              id: "mock-evidence-1",
              site_id: siteParam,
              horizon: "now",
              driver: "flood",
              hazard_score: 4.5,
              summary:
                "National Weather Service flood statements and hydrologic updates indicate rising river levels and saturated drainage basins across the plant perimeter following heavy antecedent rainfall.",
              articles: [
                {
                  title: "Regional River Basin Flood Advisory and Water Level Updates",
                  url: "https://water.weather.gov/ahps",
                  source: "weather.gov",
                  snippet:
                    "Elevated gauge readings and localized road ponding active across low-lying access corridors.",
                },
                {
                  title: "Heavy Rainfall Prompts Flood Watches and Travel Advisories",
                  url: "https://www.localnews.com/weather/flood-watch",
                  source: "localnews.com",
                  snippet:
                    "Accumulation of 3.2 inches over the last 48 hours has created standing water and high-water runoff near transmission corridors.",
                },
              ],
              model_version: "hazidx-0.1.0",
              queried_at: new Date().toISOString(),
            },
          ]
        : [],
    );
  }
  if (path === "/rest/v1/push_subscriptions") return respond(null, 201);
  if (path === "/rest/v1/push_outbox")
    return respond([
      { status: "sent", result: { recipients: 2, delivered: 2, failed: 0 } },
    ]);
  if (path === "/rest/v1/rpc/list_site_crew") {
    if (!isSupervisor) return apiError("Supervisor role required", 403);
    const supervisorRows = Object.keys(accounts)
      .filter(
        (address) =>
          accounts[address].includes(siteParam) && supervisors.has(address),
      )
      .map((address) => ({
        user_id: `user-${address}`,
        name: address.split("@")[0],
        email: address,
        role: "supervisor",
        latitude: null,
        longitude: null,
        accuracy_m: null,
        located_at: null,
        is_stale: true,
        has_push: false,
      }));
    return respond([
      ...supervisorRows,
      ...mockCrew(siteParam).map((m) => ({
        ...m,
        role: "crew",
        accuracy_m: 10,
        located_at: m.latitude === null ? null : minutesAgo(m.age),
        is_stale: m.latitude === null || m.age > 5,
        has_push: m.push,
      })),
    ]);
  }
  if (path === "/rest/v1/rpc/push_audience") {
    if (!isSupervisor) return apiError("Supervisor role required", 403);
    const target = body.p_target as { mode: string; user_ids?: string[] };
    const people = mockCrew(siteParam).filter((m) =>
      target.mode === "users"
        ? target.user_ids?.includes(m.user_id)
        : target.mode === "near"
          ? m.latitude !== null && m.age < 10
          : true,
    );
    return respond({
      targeted: people.length,
      reachable: people.filter((m) => m.push).length,
    });
  }
  if (path === "/rest/v1/rpc/send_push") {
    if (!isSupervisor) return apiError("Supervisor role required", 403);
    if (failWrites) return apiError("Mock write failure", 500);
    const target = body.p_target as { mode: string; user_ids?: string[] };
    const people = mockCrew(siteParam).filter((m) =>
      target.mode === "users"
        ? target.user_ids?.includes(m.user_id)
        : target.mode === "near"
          ? m.latitude !== null && m.age < 10
          : true,
    );
    const alert = mockAlert(
      siteParam,
      "supervisor",
      "warning",
      {
        title: String(body.p_title ?? ""),
        body: String(body.p_body ?? ""),
      },
      0,
    );
    alert.id = crypto.randomUUID();
    alert.dedup_key = `supervisor:${alert.id}`;
    alert.target_user_ids =
      target.mode === "all" ? null : people.map((m) => m.user_id);
    alerts.unshift(alert);
    notifyChange();
    return respond({ ok: true, id: crypto.randomUUID(), alert_id: alert.id });
  }
  if (path === "/rest/v1/rpc/clear_supervisor_alert") {
    if (!isSupervisor) {
      return apiError("Supervisor role required", 403);
    }
    const alert = alerts.find(
      (a) => a.id === body.p_alert_id && a.kind === "supervisor",
    );
    if (!alert) return apiError("Unknown alert", 400);
    alert.status = "cleared";
    alert.cleared_at = new Date().toISOString();
    notifyChange();
    return respond({ ok: true });
  }
  if (path === "/rest/v1/rpc/update_crew_location")
    return respond({ ok: true, exposed_alerts: [] });
  if (path === "/rest/v1/rpc/request_briefing_draft") {
    if (!isSupervisor) return apiError("Supervisor role required", 403);
    drafts.set(siteParam, {
      ...mockDraft(siteParam),
      status: "generating",
      content: {},
    });
    setTimeout(() => {
      drafts.set(siteParam, mockDraft(siteParam));
      notifyChange();
    }, 2500);
    return respond({ ok: true });
  }
  if (path === "/rest/v1/rpc/save_briefing_draft") {
    const draft = drafts.get(siteParam);
    if (!isSupervisor || !draft || draft.status === "sent")
      return apiError("No editable draft for that date", 400);
    draft.content = body.p_content as Record<string, unknown>;
    return respond({ ok: true });
  }
  if (path === "/rest/v1/rpc/send_briefing") {
    const draft = drafts.get(siteParam);
    if (!isSupervisor || !draft) return apiError("Draft is not ready", 400);
    draft.status = "sent";
    draft.sent_at = new Date().toISOString();
    return respond({ ok: true });
  }
  return apiError(`Mock backend has no handler for ${method} ${path}`, 404);
}

export function installMockBackend(): void {
  const base = new URL(import.meta.env.VITE_SUPABASE_URL as string);
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request?.url ?? String(input), location.href);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
      return realFetch(input, init);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? request?.headers);
    const rawBody = init?.body;
    let body: unknown;
    if (typeof rawBody === "string") {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = undefined;
      }
    }
    if (method === "OPTIONS") return respond(null, 204);
    await delay(latency);
    return handle(
      { method, url, headers, body },
      url.pathname.slice(base.pathname.length),
    );
  };

  const RealWebSocket = window.WebSocket;
  window.WebSocket = new Proxy(RealWebSocket, {
    construct(target, args: [string | URL, (string | string[])?]) {
      return String(args[0]).includes(`${base.pathname}/realtime/`)
        ? (new MockSocket(String(args[0])) as unknown as WebSocket)
        : Reflect.construct(target, args);
    },
  });

  document.title = `[mock] ${document.title}`;
  console.info(
    "%cMock backend active",
    "font-weight:bold",
    `\nSign in with any demo account (${Object.keys(accounts).join(", ")}) and password ${PASSWORD}.` +
      "\nAdd ?latency=1500 to slow responses, ?fail to make writes fail. State resets on reload.",
  );
}
