import { useCallback, useEffect, useState } from "react";
import { fetchSiteOverviews, type SiteSummary } from "../lib/monitoring";
import { supabase } from "../lib/supabase";

const POLL_MS = 30000;
const WATCHED = ["site_risk", "alerts", "lightning_state"];
let sequence = 0;

/**
 * Every site the signed-in user can see, kept current. Like useLive but not keyed by one
 * site: it polls every 30 seconds and refetches when risk, alerts or lightning change.
 */
export function useSiteOverviews(): { sites: SiteSummary[]; loaded: boolean } {
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSites(await fetchSiteOverviews());
      setLoaded(true);
    } catch {
      // Keep the last good list; the next poll or change retries.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => !cancelled && void refresh(), 200);
    };
    void refresh();
    let channel = supabase.channel(`site-overviews-${++sequence}`);
    for (const table of WATCHED)
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        soon,
      );
    channel.subscribe();
    const interval = setInterval(() => {
      if (!document.hidden) soon();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) soon();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  return { sites, loaded };
}
