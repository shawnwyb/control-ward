import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../lib/format";
import {
  fetchSiteCrew,
  isMissingFunction,
  type CrewMember,
} from "../../lib/crew";

type State =
  | { status: "loading" }
  | { status: "error"; message: string; needsMigration: boolean }
  | { status: "ready"; members: CrewMember[] };

/** The roster for one site. Loads on mount; `refresh` reloads it after a change. */
export function useSiteCrew(siteId: string) {
  const [state, setState] = useState<State>({ status: "loading" });
  const versionRef = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++versionRef.current;
    try {
      const members = await fetchSiteCrew(siteId);
      if (version === versionRef.current)
        setState({ status: "ready", members });
    } catch (error) {
      if (version !== versionRef.current) return;
      setState({
        status: "error",
        message: errorMessage(error),
        needsMigration: isMissingFunction(error),
      });
    }
  }, [siteId]);

  useEffect(() => {
    setState({ status: "loading" });
    void refresh();
    return () => {
      versionRef.current++;
    };
  }, [refresh]);

  return { state, refresh };
}
