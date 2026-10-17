import { useCallback } from "react";
import { fetchCrew, type CrewMember } from "../lib/monitoring";
import { useLive } from "./useLive";

const none: CrewMember[] = [];

/** Supervisor roster with last known locations. Realtime on crew_locations, polled every 30 s as a fallback. */
export function useCrewRoster(
  siteId: string,
  enabled: boolean,
  onError: (message: string) => void,
) {
  const load = useCallback(
    (id: string) => (enabled ? fetchCrew(id) : Promise.resolve(none)),
    [enabled],
  );
  const { data, loaded } = useLive(
    siteId,
    enabled ? ["crew_locations"] : [],
    load,
    none,
    30000,
    onError,
  );
  return { crew: data, loaded };
}
