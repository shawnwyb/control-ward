/*
 * Next-day safety report: the JSON written by reports/next-day (run.sh build) into public/reports/<eia>/.
 * Paths inside a report (routes_file, shading_file, map_file) are relative to /reports/<eia>/.
 * Spec: docs/NEXT_DAY_REPORT_BRIEF.md.
 */

export const SCHEMA_VERSION = 1;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type SectionStatus = "ok" | "stale" | "missing" | "not_applicable";
type Base = { status: SectionStatus; reason?: string };

export type VerdictLevel = "go" | "limits" | "reschedule";
export type BandId =
  "low" | "caution" | "extreme_caution" | "danger" | "extreme_danger";

export type HourRow = {
  hour: number;
  safe: boolean;
  blocked_by: string[];
  hi: number | null;
  wbgt: number | null;
  gust: number | null;
  pop: number | null;
  mm: number | null;
  cape: number | null;
  uv: number | null;
  temp: number | null;
  feels: number | null;
  rh: number | null;
  have_data: boolean;
  band: BandId | null;
  aqi: number | null;
  tide_near_high: boolean;
};

export type HeatBand = {
  id: BandId;
  name: string;
  min: number | null;
  water_every_min: number | null;
  rest: string | null;
  effects: string | null;
  action: string;
};

export type NwsAlert = {
  event: string;
  severity: string | null;
  urgency: string | null;
  headline: string | null;
  starts: string | null;
  ends: string | null;
  sender: string | null;
};

export type WorkWindow = { start: string; end: string };

export type Verdict = {
  level: VerdictLevel;
  label: string;
  reasons: { level: "limits" | "reschedule"; code: string; text: string }[];
  disclaimer: string;
  work_window: WorkWindow | null;
};

export type Acclimatization = {
  source: { urls: string[]; retrieved: string; verified: string };
  who: string;
  new: {
    label: string;
    unit: string;
    schedule: { day: number; max_percent: number }[];
  };
  experienced: {
    label: string;
    unit: string;
    schedule: { day: number; max_percent: number }[];
  };
  notes: string[];
};

export type HeatSection = Base & {
  source?: {
    table: string;
    url: string;
    retrieved: string;
    verified: string;
    osha: string[];
  };
  bands?: HeatBand[];
  wbgt_tiers?: { min: number; name: string }[];
  hours?: {
    hour: number;
    hi: number | null;
    wbgt: number | null;
    band: BandId | null;
    band_full_sun_max: BandId | null;
    hi_full_sun_max: number | null;
    wbgt_tier: string | null;
  }[];
  peak?: {
    hour: number;
    hi: number;
    band: BandId;
    wbgt: number | null;
    hi_full_sun_max: number | null;
  };
  hottest_window?: WorkWindow;
  workday_hours_by_band?: Partial<Record<BandId, number>>;
  acclimatization?: Acclimatization;
  water_plan?: {
    start: string;
    end: string;
    band: BandId;
    name: string;
    water_every_min: number | null;
    rest: string | null;
    action: string;
  }[];
  notes?: string[];
};

export type WeatherSection = Base & {
  hours?: {
    hour: number;
    pop: number | null;
    cape: number | null;
    gust: number | null;
    mm: number | null;
  }[];
  limits?: { wbgt: number; gust: number; pop: number; mm: number };
  work_window?: WorkWindow | null;
  blocked_runs?: { start: string; end: string; reasons: string[] }[];
  alerts: NwsAlert[];
  alerts_status?: "ok" | "missing";
  alerts_reason?: string | null;
  text?: {
    name: string;
    daytime: boolean;
    starts: string;
    temperature_f: number | null;
    short: string | null;
    detail: string | null;
  }[];
  text_reason?: string | null;
  sun?: { sunrise: string; sunset: string } | null;
};

export type HazardIndexSection = Base & {
  score?: number;
  tier?: string;
  top_driver?: string;
  top_driver_text?: string;
  probabilities?: Record<"heat" | "storm" | "flood" | "fire", number>;
  risk_preview?: number;
  rule_max_forecast?: number;
  drift_flags?: string[];
  inputs?: Record<string, number>;
  model_version?: string;
  forecast_model?: string;
  run_at_utc?: string;
  caveats?: string[];
};

export type MudSection = Base & {
  label?: string;
  model_version?: string;
  generated_at?: string;
  horizon?: {
    key: string;
    date: string;
    label: string;
    rain_in: number;
    soil_moisture: number;
  };
  passes?: number;
  default_equipment?: string;
  thresholds_in?: { inspect: number; hold: number };
  equipment?: {
    key: string;
    label: string;
    score: number;
    score_p90: number;
    worst_flag: "ok" | "inspect" | "hold";
    flagged_route_ft: number;
    route_ft: number;
    inspect_acres: number;
    hold_acres: number;
  }[];
  segment_counts?: { ok: number; inspect: number; hold: number };
  routes_file?: string | null;
  locally_validated?: boolean;
  caveats?: string[];
};

export type AirSection = Base & {
  hours?: {
    hour: number;
    us_aqi: number | null;
    pm2_5: number | null;
    pm10: number | null;
  }[];
  peak?: {
    hour: number;
    us_aqi: number;
    pm2_5: number | null;
    band: { min: number; name: string; meaning: string };
  } | null;
  bands?: { min: number; name: string; meaning: string }[];
  alerts?: NwsAlert[];
  wildfire?: {
    nearest_mi: number | null;
    nearest_name: string | null;
    within_25_mi: number;
  } | null;
  hazard_index_fire_probability?: number | null;
  notes?: string[];
};

export type RiverSection = Base & {
  gauge?: { lid: string; name: string; distance_km: number; url?: string };
  stage_unit?: string;
  thresholds?: Partial<
    Record<"action" | "minor" | "moderate" | "major", number>
  >;
  observed?: {
    stage: number;
    time: string;
    category: string;
    change_6h: number | null;
    trend: "rising" | "falling" | "steady" | null;
  } | null;
  forecast?: {
    crest: { stage: number; time: string; category: string };
    report_day_max: { stage: number; category: string } | null;
    last_point: string;
  } | null;
  forecast_note?: string;
  flag?: string;
  caveats?: string[];
};

export type LeveeSection = Base & {
  inside_leveed_area?: boolean;
  nearest_levee_km?: number | null;
  systems?: {
    id: string;
    name: string | null;
    inside: boolean;
    nearest_km: number | null;
    inspection_rating: string | null;
    fema_accreditation?: string;
    flood_sources?: string;
    leveed_area_sq_mi?: number;
    warning_system?: string;
  }[];
  closure_structures?: number;
  pump_stations?: number;
  map_file?: string | null;
  caveats?: string[];
  inspection_rating_note?: string;
  source?: { name: string; url: string };
};

export type TideSection = Base & {
  station?: {
    id: string;
    name: string;
    distance_km: number;
    reviewed: boolean;
    url: string;
  };
  events?: {
    t: string;
    type: "H" | "L";
    m_mllw: number;
    ft_mllw: number;
    m_navd88: number | null;
  }[];
  rising?: { start: string; end: string; from_m: number; to_m: number }[];
  falling?: { start: string; end: string; from_m: number; to_m: number }[];
  near_high?: { start: string; end: string; peak: string; peak_m: number }[];
  highest?: {
    t: string;
    m_mllw: number;
    ft_mllw: number;
    m_navd88: number | null;
  } | null;
  navd88_available?: boolean;
  shading_file?: string | null;
  shading_reason?: string;
  caveats?: string[];
};

export type ChangesSection = Base & {
  since?: string;
  since_kind?: "evening" | "morning";
  items: { section: string; text: string }[];
};

/** One condition that blocks a task. `hour` blockers block the hours where the factor reaches the limit; `site` blockers block the whole day. */
export type Blocker = {
  id: string;
  kind: "hour" | "site";
  factor?:
    "wbgt" | "hi" | "gust" | "pop" | "mm" | "cape" | "aqi" | "tide_near_high";
  limit?: number;
  flag?: "mud" | "river";
  values?: string[];
  label: string;
  unit?: string;
  source: string;
  needs_confirmation: boolean;
  only_if?: "tide_shading";
};

export type TaskProfile = {
  id: string;
  label: string;
  description: string;
  blockers: Blocker[];
};

export type TasksSection = Base & {
  profiles: TaskProfile[];
  site_flags: {
    mud: string | null;
    river: string | null;
    tide_shading: boolean;
  };
  note: string;
};

export type WildlifeSection = Base & {
  radius_km?: number;
  days?: number;
  season_radius_km?: number;
  recent_total?: number;
  recent_shown?: number;
  obscured_not_drawn?: number;
  groups?: {
    id: string;
    label: string;
    recent: number;
    season: {
      label: string;
      month: number;
      this_month: number;
      year_total: number;
      months: number[];
    };
  }[];
  map_file?: string | null;
  caveats?: string[];
  source?: { name: string; url: string; note: string };
};

export type RoutingSection = Base & {
  graph_file?: string | null;
  edges?: number;
  rated_edges?: number;
  radius_m?: number;
  tide_wet_edges?: number;
  caveats?: string[];
  source?: { name: string; url: string };
};

export type Gap = { section: string; status: SectionStatus; reason: string };

export type NextDayReport = {
  schema_version: number;
  meta: {
    site: {
      eia: string;
      name: string;
      latitude: number;
      longitude: number;
      timezone: string;
      utility: string | null;
      plant_type: string | null;
    };
    for_date: string;
    kind: "evening" | "morning";
    generated_at: string;
    snapshot: string;
    sources: Record<string, { url: string; fetched_at: string }>;
    label: string;
  };
  verdict: Verdict;
  weather: WeatherSection;
  heat: HeatSection;
  hazard_index: HazardIndexSection;
  mud: MudSection;
  air: AirSection;
  flood: {
    status: SectionStatus;
    river: RiverSection;
    levees: LeveeSection;
    tide: TideSection;
  };
  hourly: HourRow[];
  changes?: ChangesSection;
  tasks?: TasksSection;
  wildlife?: WildlifeSection;
  routing?: RoutingSection;
  limits: string[];
  gaps: Gap[];
};

export type ReportResult =
  | { kind: "ok"; report: NextDayReport; stale: boolean }
  | { kind: "none" }
  | { kind: "error"; message: string };

/** Public URL of a file next to a site's reports. `rel` comes from the report, for example "2026-10-19/mud_routes.geojson". */
export function reportFileUrl(eia: string, rel: string): string {
  return `/reports/${encodeURIComponent(eia)}/${rel}`;
}

export async function fetchReport(
  eia: string,
  signal?: AbortSignal,
): Promise<ReportResult> {
  let res: Response;
  try {
    res = await fetch(reportFileUrl(eia, "latest.json"), {
      signal,
      cache: "no-cache",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      kind: "error",
      message: "The report could not be loaded. Check your connection.",
    };
  }
  // The dev server answers an unknown path with index.html, so check the type as well as the status.
  const type = res.headers.get("content-type") ?? "";
  if (res.status === 404 || (res.ok && !type.includes("json")))
    return { kind: "none" };
  if (!res.ok)
    return {
      kind: "error",
      message: `The report server answered ${res.status}.`,
    };
  let report: NextDayReport;
  try {
    report = (await res.json()) as NextDayReport;
  } catch {
    return { kind: "error", message: "The report file is damaged." };
  }
  if (report.schema_version !== SCHEMA_VERSION)
    return {
      kind: "error",
      message: `This report uses format ${report.schema_version}. The app reads format ${SCHEMA_VERSION}. Rebuild the report.`,
    };
  return {
    kind: "ok",
    report,
    stale: Date.now() - Date.parse(report.meta.generated_at) > STALE_AFTER_MS,
  };
}

/** "Mon, Oct 19" for a report date (YYYY-MM-DD), without any time zone shift. */
export function formatReportDate(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Clock time of an instant in the site's own zone, for example "6:00 PM EDT". */
export function formatSiteTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  });
}

/** "5:32 AM" from a site-local ISO string such as "2026-10-19T05:32" (no zone shift). */
export function formatLocalClock(local: string): string {
  const [h, m] = local.slice(11, 16).split(":").map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function formatHour(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "AM" : "PM"}`;
}

export function clockFromHHMM(value: string): string {
  return formatLocalClock(`0000-00-00T${value}`);
}
