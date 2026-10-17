// Fictional UI fixtures only. Never imported in production. Real permissions live in SQL.
import type {
  Evidence,
  Publication,
  Revision,
  SafetyDraft,
  SafetyJob,
  SafetyProfile,
  Workspace,
} from "../features/safety/api";
type Row = Record<string, unknown>;
interface State {
  context: NonNullable<Workspace["context"]>;
  run: Workspace["run"];
  revision: Revision | null;
  publication: Publication | null;
  evidence: Evidence[];
  created: number;
}
const states = new Map<string, State>();
const reads = new Set<string>();
const scenario = () => new URLSearchParams(location.search).get("safety") ?? "";
const ev = (site: string): Evidence => ({
  id: `demo-policy-${site}`,
  kind: "company_policy",
  title: "FICTIONAL DEMO company pre-job procedure",
  instruction:
    "DEMO ONLY: confirm the work plan and current site procedure with the supervisor before work.",
  conditions:
    "Fictional demonstration. Not a real regulation or approved employer procedure.",
  excerpt:
    "FICTIONAL DEMO: the supervisor reviews the planned task, equipment and unknown conditions with the crew before work.",
  audience: "crew",
  url: null,
  fictional: true,
});
function content(site: string): SafetyDraft {
  return {
    worker_items: [
      {
        type: "company_policy",
        task: "electrical_maintenance",
        text: ev(site).instruction,
        conditions: ev(site).conditions,
        explanation: "Fictional demonstration only.",
        evidence_ids: [ev(site).id],
        applicability: "supported",
      },
    ],
    supervisor_items: [],
    coverage_gaps: [
      scenario() === "missing"
        ? "Missing approved procedure and unknown employer coverage. Confirm context before work."
        : "FICTIONAL DEMO ONLY. This example does not establish regulatory coverage.",
      ...(scenario() === "stale"
        ? ["Hazard feed missing or stale. Check live conditions."]
        : []),
    ],
    admin_notes: "PRIVATE DEMO: confirm task scope with employee in charge.",
  };
}
function revision(
  state: State,
  site: string,
  payload = content(site),
): Revision {
  return {
    id: crypto.randomUUID(),
    run_id: state.run?.id ?? "demo-run",
    revision: (state.revision?.revision ?? 0) + 1,
    content: payload,
    created_at: new Date().toISOString(),
  };
}
function publication(state: State, site: string, date: string): Publication {
  const rev = state.revision ?? revision(state, site);
  return {
    id: crypto.randomUUID(),
    revision_id: rev.id,
    published_by: "Demo supervisor",
    published_at: new Date().toISOString(),
    valid_until: `${date}T23:59:59Z`,
    status: "published",
    needs_review: scenario() === "stale",
    expired: false,
    acknowledged: false,
    worker_payload: {
      worker_items: rev.content.worker_items,
      coverage_gaps: rev.content.coverage_gaps,
      evidence: state.evidence,
    },
  };
}
function get(site: string, date: string): State {
  const key = `${site}:${date}`;
  let state = states.get(key);
  if (state) return state;
  state = {
    context: {
      profile: {
        state: "FL",
        employer_sector: scenario() === "missing" ? "unknown" : "private",
        classification: "operations_maintenance",
        enabled: true,
      },
      profile_revision: 0,
      job: {
        task: "electrical_maintenance",
        description: "",
        equipment: "",
        conditions: "",
        energized: "unknown",
      },
      job_revision: 0,
    },
    run: null,
    revision: null,
    publication: null,
    evidence: [ev(site)],
    created: 0,
  };
  if (["published", "stale", "revised"].includes(scenario())) {
    state.revision = revision(state, site);
    state.publication = publication(state, site, date);
    if (scenario() === "revised") state.revision = revision(state, site);
  }
  states.set(key, state);
  return state;
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
const error = (message: string, status = 400) =>
  response({ message, code: "SAFETY_DEMO" }, status);
export function handleSafety(
  path: string,
  body: Row,
  email: string,
  memberSites: string[],
  supervisor: boolean,
  fail: boolean,
): Response | undefined {
  const name = path.replace("/rest/v1/rpc/", "");
  if (
    ![
      "get_safety_workspace",
      "save_safety_context",
      "request_safety_briefing",
      "edit_safety_revision",
      "publish_safety_revision",
      "withdraw_safety_publication",
      "acknowledge_safety_publication",
    ].includes(name)
  )
    return;
  let site = String(body.p_site_id ?? "");
  let date = String(body.p_work_date ?? "");
  let state: State | undefined;
  if (body.p_revision_id || body.p_publication_id) {
    const entry = [...states.entries()].find(
      ([, s]) =>
        (body.p_revision_id && s.revision?.id === body.p_revision_id) ||
        (body.p_publication_id && s.publication?.id === body.p_publication_id),
    );
    if (!entry) return error("Unknown revision");
    [site, date] = entry[0].split(":");
    state = entry[1];
  }
  if (!memberSites.includes(site))
    return error("Site membership required", 403);
  state ??= get(site, date);
  if (name === "get_safety_workspace") {
    if (
      state.run?.state === "queued" &&
      Date.now() - state.created > 700 &&
      scenario() !== "pending" &&
      scenario() !== "retry"
    ) {
      if (scenario() === "failed") {
        state.run.state = "failed";
        state.run.error_category = "provider_unavailable";
      } else {
        state.run.state = "succeeded";
        state.revision = revision(state, site);
      }
    }
    const pub = state.publication
      ? {
          ...state.publication,
          acknowledged: reads.has(`${email}:${state.publication.id}`),
        }
      : null;
    return response({
      enabled: true,
      publication: pub,
      freshness: {
        feed_stale: scenario() === "stale",
        needs_review: scenario() === "stale",
        captured_at: new Date().toISOString(),
      },
      ...(supervisor
        ? {
            context: state.context,
            run: state.run,
            revision: state.revision,
            evidence: state.evidence,
          }
        : {}),
    });
  }
  if (fail) return error("Simulated safety write failure (?fail)", 500);
  if (name === "acknowledge_safety_publication") {
    const pub = state.publication;
    if (!pub || pub.status !== "published" || pub.needs_review)
      return error("Checklist no longer current");
    reads.add(`${email}:${pub.id}`);
    return response(null);
  }
  if (!supervisor) return error("Supervisor role required", 403);
  if (name === "save_safety_context") {
    if (
      body.p_profile_revision !== state.context.profile_revision ||
      body.p_job_revision !== state.context.job_revision
    )
      return error("Context changed; reload");
    state.context = {
      profile: body.p_profile as SafetyProfile,
      job: body.p_job as SafetyJob,
      profile_revision: state.context.profile_revision + 1,
      job_revision: state.context.job_revision + 1,
    };
    if (state.publication) state.publication.needs_review = true;
    return response(state.context);
  }
  if (name === "request_safety_briefing") {
    if (!state.context.job_revision) return error("Save work context first");
    if (state.run?.state === "queued") return response(state.run.id);
    state.run = {
      id: crypto.randomUUID(),
      state: "queued",
      attempt: scenario() === "retry" ? 2 : 1,
      error_category: scenario() === "retry" ? "provider_rate_limited" : null,
      available_at: new Date(Date.now() + 30000).toISOString(),
      created_at: new Date().toISOString(),
    };
    state.created = Date.now();
    return response(state.run.id);
  }
  if (name === "withdraw_safety_publication") {
    if (state.publication) state.publication.status = "withdrawn";
    return response(null);
  }
  if (!state.revision || state.revision.revision !== body.p_expected_revision)
    return error("Revision changed; reload");
  if (name === "edit_safety_revision") {
    state.revision = revision(state, site, body.p_content as SafetyDraft);
    return response(state.revision.id);
  }
  if (name === "publish_safety_revision") {
    state.publication = publication(state, site, date);
    return response(state.publication.id);
  }
}
