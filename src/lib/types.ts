import type { Database } from "../database.types";

export type Site = Database["public"]["Tables"]["sites"]["Row"];
export type HazardType = Database["public"]["Enums"]["hazard_type"];
export type Severity = 1 | 2 | 3;
export type Report = Omit<
  Database["public"]["Tables"]["hazard_reports"]["Row"],
  "location"
> & {
  latitude: number;
  longitude: number;
  is_active: boolean;
};
export type MutationResult = {
  outcome: "created" | "merged" | "confirmed" | "resolved";
  report: Report;
};
export type Photo = Database["public"]["Tables"]["hazard_photos"]["Row"];
export type Observation =
  Database["public"]["Tables"]["hazard_observations"]["Row"];
export type SiteMetrics = {
  openReports: number;
  crewRisk: number;
  wildlifeSubscore: number;
};

export const hazardLabels: Record<HazardType, string> = {
  debris: "Debris",
  wildlife: "Wildlife",
  downed_line: "Downed line",
  washout: "Washout",
  other: "Other",
};

export const severityLabels: Record<Severity, string> = {
  1: "Low",
  2: "Moderate",
  3: "High",
};

export type Alert = Database["public"]["Tables"]["alerts"]["Row"];
export type AlertKind = "lightning" | "flood" | "heat" | "wildfire" | "other";
export type AlertLevel = "info" | "warning" | "stop_work";
export type SiteOverview = Database["public"]["Views"]["site_overview"]["Row"];
export type Briefing = Database["public"]["Tables"]["briefings"]["Row"];
