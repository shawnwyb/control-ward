import type { Json } from "../database.types";
import { READINGS_WINDOW_MS, type Reading } from "./explain";
import { supabase } from "./supabase";
import { riskLevel, riskTone } from "./risk";
import {
  rankSites,
  siteSummaryFromRow,
  topHazards,
  type SiteSummary,
} from "./sites";

export { riskLevel, riskTone, rankSites, topHazards };
export type { SiteSummary };

export type Role = "crew" | "supervisor";

export type Subscores = Partial<
  Record<
    | "weather"
    | "lightning"
    | "flood"
    | "heat"
    | "wildfire"
    | "soil"
    | "wildlife",
    number
  >
>;

export type SiteRiskView = {
  riskNow: number | null;
  riskTomorrow: number | null;
  topDriver: string | null;
  subscores: Subscores;
  activeAlerts: number;
};

export type HazardArticle = {
  title: string;
  url: string;
  source: string;
  snippet?: string;
  published_at?: string;
};

export type HazardEvidenceView = {
  id: string;
  site_id: string;
  horizon: "now" | "tomorrow";
  driver: string;
  hazard_score: number;
  summary: string;
  articles: HazardArticle[];
  model_version: string;
  queried_at: string;
};

export type AlertRow = {
  id: string;
  kind: string;
  level: "info" | "warning" | "stop_work";
  created_at: string;
  payload: Record<string, unknown>;
};

export type LightningView = {
  status: "clear" | "stop_work";
  lastStrikeAt: string | null;
  lastStrikeDistanceM: number | null;
};

export type CrewMember = {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  located_at: string | null;
  is_stale: boolean;
  has_push: boolean;
};

export type WorkWindow = { start: string; end: string };
export type PlanHour = {
  hour: number;
  wbgt: number | null;
  gust: number | null;
  pop: number | null;
  mm: number | null;
  safe: boolean;
  blocked_by: string[];
};
export type BriefingContent = {
  work_window: WorkWindow | null;
  summary: string;
  reasons: string[];
  context: { traffic: string; school: string; wildlife: string };
  /** Set when the AI step failed and the draft is forecast rules only. */
  ai_note?: string;
  hourly?: PlanHour[];
  hazards?: { metric: string; forecast: number; unit: string; level: string }[];
  neighbors?: {
    name: string;
    distance_km: number;
    risk_tomorrow: number | null;
    driver: string | null;
  }[];
};
export type BriefingDraft = {
  site_id: string;
  for_date: string;
  status: "generating" | "draft" | "sent";
  source: "gemini" | "rules" | null;
  updated_at: string;
  sent_at: string | null;
  content: BriefingContent;
};

export type PushTarget =
  | { mode: "all" }
  | { mode: "users"; user_ids: string[] }
  | { mode: "near"; lat: number; lon: number; radius_m: number };

export async function fetchRoles(): Promise<Record<string, Role>> {
  const { data, error } = await supabase
    .from("site_memberships")
    .select("site_id, role");
  if (error) throw error;
  return Object.fromEntries(data.map((row) => [row.site_id, row.role as Role]));
}

export async function fetchSiteRisk(siteId: string): Promise<SiteRiskView> {
  const { data, error } = await supabase
    .from("site_overview")
    .select("*")
    .eq("site_id", siteId)
    .maybeSingle();
  if (error) throw error;
  return {
    riskNow: data?.risk_now ?? null,
    riskTomorrow: data?.risk_tomorrow ?? null,
    topDriver: data?.top_driver ?? null,
    subscores: (data?.subscores ?? {}) as Subscores,
    activeAlerts: data?.active_alert_count ?? 0,
  };
}

/** One model's 0-10 score from ml_scores. */
export type MlScore = {
  score: number;
  horizon: "now" | "tomorrow";
  modelVersion: string;
  computedAt: string;
};

/** Each model's score for a site, keyed by model ("hazard_index", "mud"); tomorrow's row wins over now's. */
export type MlScores = Partial<Record<string, MlScore>>;

export async function fetchMlScores(siteId: string): Promise<MlScores> {
  const { data, error } = await supabase
    .from("ml_scores")
    .select("model, horizon, score, model_version, computed_at")
    .eq("site_id", siteId);
  if (error) throw error;
  const out: MlScores = {};
  for (const row of data) {
    const held = out[row.model];
    if (held && held.horizon === "tomorrow") continue;
    out[row.model] = {
      score: Number(row.score),
      horizon: row.horizon as MlScore["horizon"],
      modelVersion: row.model_version,
      computedAt: row.computed_at,
    };
  }
  return out;
}

/** Live readings (not forecasts) from the window the rules engine looks at, newest first. */
export async function fetchReadings(siteId: string): Promise<Reading[]> {
  const since = new Date(Date.now() - READINGS_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("readings")
    .select("hazard, unit, value, observed_at, forecast_for")
    .eq("site_id", siteId)
    .eq("forecast_for", "-infinity")
    .gte("observed_at", since)
    .order("observed_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return data as Reading[];
}

/** One summary per site the caller can see (row-level security scopes the view). */
export async function fetchSiteOverviews(): Promise<SiteSummary[]> {
  const { data, error } = await supabase.from("site_overview").select("*");
  if (error) throw error;
  return data.flatMap((row) => {
    const summary = siteSummaryFromRow(row);
    return summary ? [summary] : [];
  });
}

export async function fetchAlerts(siteId: string): Promise<AlertRow[]> {
  const { data, error } = await supabase
    .from("alerts")
    .select("id, kind, level, created_at, payload")
    .eq("site_id", siteId)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as AlertRow[];
}

export async function fetchLightning(siteId: string): Promise<LightningView> {
  const { data, error } = await supabase
    .from("lightning_state")
    .select("*")
    .eq("site_id", siteId)
    .maybeSingle();
  if (error) throw error;
  return {
    status: (data?.status as LightningView["status"]) ?? "clear",
    lastStrikeAt: data?.last_strike_at ?? null,
    lastStrikeDistanceM: data?.last_strike_distance_m ?? null,
  };
}

export async function fetchCrew(siteId: string): Promise<CrewMember[]> {
  const { data, error } = await supabase.rpc("list_site_crew", {
    p_site_id: siteId,
  });
  if (error) throw error;
  return data as CrewMember[];
}

export async function fetchBriefingDraft(
  siteId: string,
): Promise<BriefingDraft | null> {
  const { data, error } = await supabase
    .from("briefing_drafts")
    .select("*")
    .eq("site_id", siteId)
    .order("for_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as unknown as BriefingDraft) : null;
}

export async function requestBriefingDraft(siteId: string): Promise<void> {
  const { error } = await supabase.rpc("request_briefing_draft", {
    p_site_id: siteId,
  });
  if (error) throw error;
}

export async function saveBriefingDraft(
  siteId: string,
  forDate: string,
  content: BriefingContent,
): Promise<void> {
  const { error } = await supabase.rpc("save_briefing_draft", {
    p_site_id: siteId,
    p_for_date: forDate,
    p_content: content as unknown as Json,
  });
  if (error) throw error;
}

export async function sendBriefing(
  siteId: string,
  forDate: string,
): Promise<void> {
  const { error } = await supabase.rpc("send_briefing", {
    p_site_id: siteId,
    p_for_date: forDate,
  });
  if (error) throw error;
}

export async function pushAudience(
  siteId: string,
  target: PushTarget,
): Promise<{ targeted: number; reachable: number }> {
  const { data, error } = await supabase.rpc("push_audience", {
    p_site_id: siteId,
    p_target: target as unknown as Json,
  });
  if (error) throw error;
  return data as { targeted: number; reachable: number };
}

export async function sendPush(
  siteId: string,
  title: string,
  body: string,
  target: PushTarget,
): Promise<string> {
  const { data, error } = await supabase.rpc("send_push", {
    p_site_id: siteId,
    p_title: title,
    p_body: body,
    p_target: target as unknown as Json,
  });
  if (error) throw error;
  return (data as { id: string }).id;
}

export type PushOutcome = {
  status: "pending" | "sending" | "sent" | "failed";
  recipients: number;
  delivered: number;
  failed: number;
};

/** Waits for the sender to process a queued push (up to about 20 s) and returns what happened. */
export async function waitForPush(id: string): Promise<PushOutcome | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const { data, error } = await supabase
      .from("push_outbox")
      .select("status, result")
      .eq("id", id)
      .maybeSingle();
    if (error) return null;
    if (data && (data.status === "sent" || data.status === "failed")) {
      const result = (data.result ?? {}) as Record<string, number>;
      return {
        status: data.status,
        recipients: result.recipients ?? 0,
        delivered: result.delivered ?? 0,
        failed: result.failed ?? 0,
      };
    }
  }
  return null;
}

export async function shareLocation(
  siteId: string,
  latitude: number,
  longitude: number,
  accuracy?: number,
): Promise<void> {
  const { error } = await supabase.rpc("update_crew_location", {
    p_site_id: siteId,
    p_lat: latitude,
    p_lon: longitude,
    p_accuracy_m: accuracy,
  });
  if (error) throw error;
}

/** Which of these alerts the signed-in user has acknowledged (row-level security allows only their own rows). */
export async function fetchAcknowledged(
  alertIds: string[],
  userId: string,
): Promise<Set<string>> {
  if (!alertIds.length) return new Set();
  const { data, error } = await supabase
    .from("alert_acks")
    .select("alert_id")
    .in("alert_id", alertIds)
    .eq("user_id", userId);
  if (error) throw error;
  return new Set(data.map((row) => row.alert_id));
}

/** Acknowledge an alert. Safe to repeat: the database keeps the first acknowledgement time. */
export async function acknowledgeAlert(
  requestId: string,
  alertId: string,
): Promise<void> {
  const { error } = await supabase.rpc("acknowledge_alert", {
    p_request_id: requestId,
    p_alert_id: alertId,
  });
  if (error) throw error;
}

/** Supervisor alerts have no automatic end; this takes one off the crew's screens. */
export async function clearSupervisorAlert(alertId: string): Promise<void> {
  const { error } = await supabase.rpc("clear_supervisor_alert", {
    p_alert_id: alertId,
  });
  if (error) throw error;
}

/** Fetches backing news articles and evidence for a site's hazard index drivers. */
export async function fetchHazardEvidence(
  siteId: string,
): Promise<HazardEvidenceView[]> {
  const { data, error } = await supabase
    .from("hazard_evidence")
    .select("*")
    .eq("site_id", siteId)
    .order("hazard_score", { ascending: false });
  if (error) {
    console.warn("fetchHazardEvidence:", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    ...row,
    articles: Array.isArray(row.articles)
      ? (row.articles as HazardArticle[])
      : [],
  })) as HazardEvidenceView[];
}
