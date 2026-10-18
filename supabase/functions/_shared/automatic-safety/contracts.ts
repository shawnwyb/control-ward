export interface SiteContext {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  plant_type: string | null;
  utility: string | null;
}
export interface Reading {
  id: number | string;
  hazard: string;
  value: number;
  unit: string;
  observed_at: string;
  forecast_for: string;
  source: string;
}
export interface Snapshot {
  site: SiteContext;
  work_date: string;
  captured_at: string;
  model: string;
  input_key: string;
  hazards: {
    readings: Reading[];
    alerts: Record<string, unknown>[];
    crew: Record<string, unknown>[];
    lightning: Record<string, unknown> | null;
  };
}
export interface Jurisdiction {
  state: string | null;
  state_code: string | null;
  county: string | null;
  city: string | null;
  source_url: string;
  resolved: boolean;
}
export interface Source {
  id: string;
  title: string;
  url: string;
  level: "federal" | "state" | "county" | "city";
  jurisdiction: string;
  checked_at: string;
}
export interface Document extends Source {
  text: string;
}
export interface Citation {
  source_id: string;
  quote: string;
}
export interface ChecklistItem {
  id: string;
  kind: "regulation" | "guidance";
  title: string;
  text: string;
  conditions: string;
  citations: Citation[];
}
export interface ChecklistContent {
  summary: string;
  jurisdiction: Jurisdiction;
  conditions: Reading[];
  alerts: Record<string, unknown>[];
  items: ChecklistItem[];
  sources: Source[];
  coverage_gaps: string[];
  search_entry_point?: string;
}
export interface ModelResult {
  value: unknown;
  tokens: number;
  grounded: boolean;
  research_info?: {
    search_queries: number;
    grounding_chunks: number;
    citations: number;
  };
  search_entry_point?: string;
}
export interface ResearchModel {
  ask(
    prompt: string,
    search: boolean,
    signal: AbortSignal,
  ): Promise<ModelResult>;
}
export const scopeGap =
  "Employer coverage and task-specific applicability cannot be inferred from a site's location. Regulatory excerpts retain their scope; this checklist is not a determination of complete legal coverage.";
