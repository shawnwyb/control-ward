import type {
  Evidence,
  InputSnapshot,
  SafetyDraft,
  SafetyItem,
} from "./contracts.ts";
import { supported } from "./contracts.ts";
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
export function validateDraft(
  raw: unknown,
  input: InputSnapshot,
  evidence: Map<string, Evidence>,
  requiredGaps: string[],
): SafetyDraft {
  if (
    !object(raw) ||
    JSON.stringify(raw).length > 50000 ||
    !Array.isArray(raw.worker_items) ||
    !Array.isArray(raw.supervisor_items) ||
    !Array.isArray(raw.coverage_gaps) ||
    typeof raw.admin_notes !== "string"
  )
    throw new Error("invalid_schema");
  if (
    raw.worker_items.length > 20 ||
    raw.supervisor_items.length > 20 ||
    raw.admin_notes.length > 6000 ||
    raw.coverage_gaps.length > 40 ||
    !raw.coverage_gaps.every((g) => typeof g === "string" && g.length <= 2000)
  )
    throw new Error("output_limit");
  for (const gap of requiredGaps)
    if (!raw.coverage_gaps.includes(gap))
      throw new Error("required_gap_missing");
  function item(x: unknown, worker: boolean): SafetyItem {
    if (
      !object(x) ||
      x.task !== input.job.task ||
      typeof x.explanation !== "string" ||
      x.explanation.length > 2000 ||
      !["supported", "conditional", "unresolved"].includes(
        String(x.applicability),
      ) ||
      !Array.isArray(x.evidence_ids) ||
      x.evidence_ids.length < 1 ||
      x.evidence_ids.length > 8
    )
      throw new Error("invalid_item");
    for (const id of x.evidence_ids)
      if (
        typeof id !== "string" ||
        !evidence.has(id) ||
        (worker && evidence.get(id)?.audience !== "crew")
      )
        throw new Error("invalid_citation");
    const e = evidence.get(x.evidence_ids[0])!;
    if (
      x.text !== e.instruction ||
      x.conditions !== e.conditions ||
      x.type !== e.kind
    )
      throw new Error("unreviewed_instruction");
    if (e.conflicts) throw new Error("conflicting_source");
    if (
      x.type === "legal_requirement" &&
      (!supported(input) || x.applicability !== "supported")
    )
      throw new Error("unresolved_applicability");
    if (
      requiredGaps.some((g) => g.startsWith("Source change pending")) &&
      ["legal_requirement", "company_policy"].includes(String(x.type))
    )
      throw new Error("source_review_pending");
    return x as unknown as SafetyItem;
  }
  return {
    worker_items: raw.worker_items.map((x) => item(x, true)),
    supervisor_items: raw.supervisor_items.map((x) => item(x, false)),
    coverage_gaps: raw.coverage_gaps as string[],
    admin_notes: raw.admin_notes,
  };
}
export function validateTool(
  name: string,
  args: unknown,
): Record<string, unknown> {
  if (!object(args)) throw new Error("invalid_tool_args");
  const keys = Object.keys(args);
  if (name === "get_job_context" || name === "get_site_hazards") {
    if (keys.length) throw new Error("invalid_tool_args");
    return {};
  }
  if (name === "search_regulations" || name === "search_site_documents") {
    if (
      keys.some((k) => k !== "query") ||
      typeof args.query !== "string" ||
      args.query.length > 500
    )
      throw new Error("invalid_tool_args");
    return { query: args.query };
  }
  if (name === "read_source_passage") {
    if (
      keys.some((k) => k !== "passage_id") ||
      typeof args.passage_id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(args.passage_id)
    )
      throw new Error("invalid_tool_args");
    return { passage_id: args.passage_id };
  }
  throw new Error("tool_not_allowed");
}
