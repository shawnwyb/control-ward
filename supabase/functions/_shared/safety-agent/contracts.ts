export type ItemType =
  "legal_requirement" | "company_policy" | "recommendation" | "observed_hazard";
export interface Evidence {
  id: string;
  kind: ItemType;
  title: string;
  instruction: string;
  conditions: string;
  excerpt: string;
  audience: "crew" | "supervisor";
  url: string | null;
  version_id?: string;
  passage_id?: string;
  anchor?: string;
  authority?: string;
  effective_on?: string | null;
  superseded_on?: string | null;
  observed_at?: string;
  last_checked_at?: string;
  fictional?: boolean;
  conflicts?: boolean;
}
export interface SafetyItem {
  type: ItemType;
  task: string;
  text: string;
  explanation: string;
  evidence_ids: string[];
  applicability: "supported" | "conditional" | "unresolved";
  conditions: string;
}
export interface SafetyDraft {
  supervisor_items: SafetyItem[];
  worker_items: SafetyItem[];
  coverage_gaps: string[];
  admin_notes: string;
}
export interface SafetyProfile {
  state: string;
  employer_sector: "private" | "public" | "unknown";
  classification: "operations_maintenance" | "construction" | "unknown";
  coverage_notes?: string;
  enabled: boolean;
}
export interface SafetyJob {
  task: "electrical_maintenance" | "construction" | "other";
  description: string;
  equipment: string;
  conditions: string;
  energized: "unknown" | "energized" | "deenergized";
}
export interface InputSnapshot {
  site_id: string;
  work_date: string;
  profile: SafetyProfile;
  job: SafetyJob;
  profile_revision: number;
  job_revision: number;
  model: string;
  prompt_version: string;
  captured_at: string;
  hazards: Record<string, unknown>;
  [key: string]: unknown;
}
export const toolNames = [
  "get_job_context",
  "get_site_hazards",
  "search_regulations",
  "search_site_documents",
  "read_source_passage",
] as const;
export type ToolName = (typeof toolNames)[number];
export interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}
export interface ModelReply {
  calls?: ToolCall[];
  final?: unknown;
  tokens: number;
  opaque?: unknown;
}
export interface Message {
  role: "user" | "model";
  parts: unknown[];
}
export interface ModelAdapter {
  turn(
    messages: Message[],
    signal: AbortSignal,
    maxOutputTokens: number,
  ): Promise<ModelReply>;
}
export interface ToolResult {
  data: unknown;
  evidence?: Evidence[];
}
export interface ToolAdapter {
  call(
    name: ToolName,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<ToolResult>;
}
export interface Trace {
  tool: ToolName;
  args: Record<string, unknown>;
  evidence_ids: string[];
  duration_ms: number;
  error?: string;
}
export interface Limits {
  turns: number;
  calls: number;
  tokens: number;
  wallMs: number;
  toolMs: number;
  maxSpendUsd: number;
  reservedUsdPerTurn: number;
}
export const defaultLimits: Limits = {
  turns: 8,
  calls: 12,
  tokens: 50000,
  wallMs: 80000,
  toolMs: 8000,
  maxSpendUsd: 0.5,
  reservedUsdPerTurn: 0.0625,
};
export function supported(input: InputSnapshot): boolean {
  return (
    input.profile.state === "FL" &&
    input.profile.employer_sector === "private" &&
    input.profile.classification === "operations_maintenance" &&
    input.job.task === "electrical_maintenance"
  );
}
export function instructionItem(e: Evidence, task: string): SafetyItem {
  return {
    type: e.kind,
    task,
    text: e.instruction,
    conditions: e.conditions,
    explanation: "Selected from reviewed run evidence.",
    evidence_ids: [e.id],
    applicability: "supported",
  };
}
