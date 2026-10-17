import { errorMessage } from "./format";
import { supabase } from "./supabase";

export type AssignOutcome = {
  outcome: "assigned" | "already_member";
  email: string;
  role: string;
};

/** Add an existing account to a site as crew. Never changes an existing member's role. */
export async function assignCrewMember(
  siteId: string,
  email: string,
): Promise<AssignOutcome> {
  const { data, error } = await supabase.rpc("assign_site_member", {
    p_site_id: siteId,
    p_email: email,
  });
  if (error) throw error;
  return data as unknown as AssignOutcome;
}

/** Remove a crew member from a site. Supervisors cannot be removed this way. */
export async function unassignCrewMember(
  siteId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("unassign_site_member", {
    p_site_id: siteId,
    p_user_id: userId,
  });
  if (error) throw error;
  return (data as unknown as { removed: boolean }).removed;
}

/** PostgREST's "function not found": the crew-assignment migration has not been applied. */
export function isMissingFunction(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "PGRST202"
  );
}

/** Says why a crew-management call failed, in words a supervisor can act on. */
export function describeCrewError(error: unknown): string {
  return isMissingFunction(error)
    ? "Crew management needs a database update. Ask whoever runs the project to apply the latest migration."
    : errorMessage(error);
}
