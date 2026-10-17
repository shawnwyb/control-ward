import { supabase } from "../../lib/supabase";
import type { Json } from "../../database.types";
import type {
  Evidence,
  SafetyDraft,
  SafetyJob,
  SafetyProfile,
} from "../../../supabase/functions/_shared/safety-agent/contracts";
export type {
  Evidence,
  SafetyDraft,
  SafetyItem,
  SafetyJob,
  SafetyProfile,
} from "../../../supabase/functions/_shared/safety-agent/contracts";
export interface Revision {
  id: string;
  revision: number;
  run_id: string;
  content: SafetyDraft;
  created_at: string;
}
export interface Publication {
  id: string;
  revision_id: string;
  published_by: string;
  published_at: string;
  valid_until: string;
  status: "published" | "superseded" | "withdrawn";
  needs_review: boolean;
  expired: boolean;
  acknowledged: boolean;
  worker_payload: {
    worker_items: SafetyDraft["worker_items"];
    coverage_gaps: string[];
    evidence: Evidence[];
  };
}
export interface Workspace {
  enabled: boolean;
  publication: Publication | null;
  freshness?: {
    captured_at: string;
    feed_stale: boolean;
    needs_review: boolean;
  };
  context?: {
    profile: Partial<SafetyProfile>;
    job: Partial<SafetyJob>;
    profile_revision: number;
    job_revision: number;
  };
  run?: {
    id: string;
    state: "queued" | "running" | "succeeded" | "failed";
    attempt: number;
    error_category: string | null;
    available_at: string;
    created_at: string;
  } | null;
  revision?: Revision | null;
  evidence?: Evidence[];
}
function checked<T>(response: { data: T; error: unknown }): T {
  if (response.error) throw response.error;
  return response.data;
}
export async function fetchWorkspace(
  siteId: string,
  date: string,
): Promise<Workspace> {
  return checked(
    await supabase.rpc("get_safety_workspace", {
      p_site_id: siteId,
      p_work_date: date,
    }),
  ) as unknown as Workspace;
}
export async function saveContext(
  siteId: string,
  date: string,
  expected: NonNullable<Workspace["context"]>,
  profile: SafetyProfile,
  job: SafetyJob,
) {
  checked(
    await supabase.rpc("save_safety_context", {
      p_site_id: siteId,
      p_work_date: date,
      p_profile_revision: expected.profile_revision,
      p_job_revision: expected.job_revision,
      p_profile: profile as unknown as Json,
      p_job: job as unknown as Json,
    }),
  );
}
export async function generate(
  siteId: string,
  date: string,
  regenerate: boolean,
) {
  return checked(
    await supabase.rpc("request_safety_briefing", {
      p_site_id: siteId,
      p_work_date: date,
      p_regenerate: regenerate,
    }),
  );
}
export async function editRevision(revision: Revision, content: SafetyDraft) {
  return checked(
    await supabase.rpc("edit_safety_revision", {
      p_revision_id: revision.id,
      p_expected_revision: revision.revision,
      p_content: content as unknown as Json,
    }),
  );
}
export async function publish(revision: Revision) {
  return checked(
    await supabase.rpc("publish_safety_revision", {
      p_revision_id: revision.id,
      p_expected_revision: revision.revision,
    }),
  );
}
export async function withdraw(publicationId: string) {
  checked(
    await supabase.rpc("withdraw_safety_publication", {
      p_publication_id: publicationId,
    }),
  );
}
export async function acknowledge(publicationId: string) {
  checked(
    await supabase.rpc("acknowledge_safety_publication", {
      p_publication_id: publicationId,
    }),
  );
}
