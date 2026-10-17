import { supabase } from "./supabase";
import type { Alert, Briefing, SiteOverview } from "./types";

export type MonitoringSnapshot = {
  /** Risk now and tomorrow for the site. Absent until the backend has scored it. */
  overview?: SiteOverview;
  /** Active alerts only. */
  alerts: Alert[];
  /** Ids of alerts this user has acknowledged. */
  acknowledged: Set<string>;
  /** The newest briefing for the site. */
  briefing?: Briefing;
  briefingRead: boolean;
};

export const emptyMonitoring: MonitoringSnapshot = {
  alerts: [],
  acknowledged: new Set(),
  briefingRead: false,
};

export async function fetchMonitoring(
  siteId: string,
  userId: string,
): Promise<MonitoringSnapshot> {
  const [overview, alerts, briefings] = await Promise.all([
    supabase.from("site_overview").select("*").eq("site_id", siteId).limit(1),
    supabase
      .from("alerts")
      .select("*")
      .eq("site_id", siteId)
      .eq("status", "active")
      .order("created_at", { ascending: false }),
    supabase
      .from("briefings")
      .select("*")
      .eq("site_id", siteId)
      .order("for_date", { ascending: false })
      .limit(1),
  ]);
  for (const result of [overview, alerts, briefings])
    if (result.error) throw result.error;

  const briefing = briefings.data?.[0];
  const alertIds = (alerts.data ?? []).map((alert) => alert.id);
  // Both reads are limited to the signed-in user's own rows by row-level security.
  const [acks, reads] = await Promise.all([
    alertIds.length
      ? supabase
          .from("alert_acks")
          .select("alert_id")
          .in("alert_id", alertIds)
          .eq("user_id", userId)
      : Promise.resolve({ data: [], error: null }),
    briefing
      ? supabase
          .from("briefing_reads")
          .select("briefing_id")
          .eq("briefing_id", briefing.id)
          .eq("user_id", userId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (acks.error) throw acks.error;
  if (reads.error) throw reads.error;

  return {
    overview: overview.data?.[0],
    alerts: alerts.data ?? [],
    acknowledged: new Set((acks.data ?? []).map((row) => row.alert_id)),
    briefing,
    briefingRead: (reads.data ?? []).length > 0,
  };
}

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

export async function markBriefingRead(briefingId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_briefing_read", {
    p_briefing_id: briefingId,
  });
  if (error) throw error;
}
