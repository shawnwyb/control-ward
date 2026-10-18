import { supabase } from "../../lib/supabase";
import type {
  ChecklistContent,
  Reading,
  Source,
} from "../../../supabase/functions/_shared/automatic-safety/contracts";
export type { ChecklistContent, Reading, Source };
export interface Checklist {
  id: string;
  work_date: string;
  content: ChecklistContent;
  generated_at: string;
  valid_until: string;
  current: boolean;
  acknowledged: boolean;
}
export interface Workspace {
  enabled: boolean;
  run: {
    state: "queued" | "running" | "succeeded" | "failed";
    attempt: number;
    error_category: string | null;
  } | null;
  checklist: Checklist | null;
}
export async function fetchWorkspace(
  siteId: string,
  date: string,
): Promise<Workspace> {
  const { data, error } = await supabase.rpc("get_automatic_safety_workspace", {
    p_site_id: siteId,
    p_work_date: date,
  });
  if (error) throw error;
  return data as unknown as Workspace;
}
export async function acknowledge(checklistId: string) {
  const { error } = await supabase.rpc(
    "acknowledge_automatic_safety_checklist",
    { p_checklist_id: checklistId },
  );
  if (error) throw error;
}
