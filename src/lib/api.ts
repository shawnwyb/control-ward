import { supabase } from "./supabase";
import type { Observation, Report, Site, SiteMetrics } from "./types";

export type SiteSnapshot = {
  reports: Report[];
  metrics: SiteMetrics;
  /** Distinct active hazards the crew has been asked to re-check. */
  reminderCount: number;
};

export const emptySnapshot: SiteSnapshot = {
  reports: [],
  metrics: { openReports: 0, crewRisk: 0, wildlifeSubscore: 0 },
  reminderCount: 0,
};

export async function fetchSites(): Promise<Site[]> {
  const result = await supabase.from("sites").select("*").order("name");
  if (result.error) throw result.error;
  return result.data;
}

export async function fetchSiteSnapshot(siteId: string): Promise<SiteSnapshot> {
  const [feed, metrics, tasks] = await Promise.all([
    supabase
      .from("crew_hazard_feed")
      .select("*")
      .eq("site_id", siteId)
      .order("last_confirmed_at", { ascending: false }),
    supabase.rpc("get_site_crew_metrics", { p_site_id: siteId }),
    supabase
      .from("hazard_checkin_tasks")
      .select("id, report_id")
      .is("completed_at", null),
  ]);
  for (const result of [feed, metrics, tasks])
    if (result.error) throw result.error;
  const reports = (feed.data ?? []) as Report[];
  const metric = metrics.data?.[0];
  const reminders = (tasks.data ?? []).filter((task) =>
    reports.some((report) => report.id === task.report_id && report.is_active),
  );
  return {
    reports,
    metrics: {
      openReports: metric?.open_report_count ?? 0,
      crewRisk: Number(metric?.crew_risk_term ?? 0),
      wildlifeSubscore: Number(metric?.wildlife_subscore ?? 0),
    },
    reminderCount: new Set(reminders.map((task) => task.report_id)).size,
  };
}

export async function sendCheckin(
  requestId: string,
  reportId: string,
  stillThere: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("checkin_hazard_report", {
    p_request_id: requestId,
    p_report_id: reportId,
    p_still_there: stillThere,
  });
  if (error) throw error;
}

export type HazardHistory = {
  observations: Observation[];
  photoUrls: string[];
};

export async function fetchHistory(reportId: string): Promise<HazardHistory> {
  const observations = await supabase
    .from("hazard_observations")
    .select("*")
    .eq("report_id", reportId)
    .order("created_at", { ascending: false });
  if (observations.error) throw observations.error;
  const photos = observations.data.length
    ? await supabase
        .from("hazard_photos")
        .select("*")
        .in(
          "observation_id",
          observations.data.map((o) => o.id),
        )
    : { data: [], error: null };
  if (photos.error) throw photos.error;
  const photoUrls = await Promise.all(
    photos.data.map(async (photo) => {
      const signed = await supabase.storage
        .from("hazard-photos")
        .createSignedUrl(photo.object_path, 300);
      if (signed.error) throw signed.error;
      return signed.data.signedUrl;
    }),
  );
  return { observations: observations.data, photoUrls };
}
