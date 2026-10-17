import type { Database } from "../database.types";
import { supabase } from "./supabase";

export type SiteRole = "crew" | "supervisor";
export type CrewMember =
  Database["public"]["Functions"]["list_site_crew"]["Returns"][number];

/** The signed-in user's role at each site they belong to. */
export async function fetchMyRoles(
  userId: string,
): Promise<Map<string, SiteRole>> {
  const { data, error } = await supabase
    .from("site_memberships")
    .select("site_id, role")
    .eq("user_id", userId);
  if (error) throw error;
  return new Map(
    data.map((row) => [
      row.site_id,
      row.role === "supervisor" ? "supervisor" : "crew",
    ]),
  );
}

/** Everyone on a site. Supervisors only; the database refuses anyone else. */
export async function fetchSiteCrew(siteId: string): Promise<CrewMember[]> {
  const { data, error } = await supabase.rpc("list_site_crew", {
    p_site_id: siteId,
  });
  if (error) throw error;
  return data;
}

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
