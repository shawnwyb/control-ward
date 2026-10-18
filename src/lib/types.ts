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
  mud: "Mud or rut",
};

export const severityLabels: Record<Severity, string> = {
  1: "Low",
  2: "Moderate",
  3: "High",
};
