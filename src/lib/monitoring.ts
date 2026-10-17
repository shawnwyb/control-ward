import type { Json } from "../database.types";
import { supabase } from "./supabase";

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

/** Heat, rain, wind and storms at a glance. Matches the rules engine's 0 to 10 scale. */
export function riskLevel(risk: number | null): {
  label: string;
  tone: "ok" | "caution" | "danger" | "unknown";
} {
  if (risk === null) return { label: "No data", tone: "unknown" };
  if (risk >= 7) return { label: "High", tone: "danger" };
  if (risk >= 4) return { label: "Elevated", tone: "caution" };
  return { label: "Low", tone: "ok" };
}
