import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/format";
import { fetchSiteOverviews, type SiteSummary } from "../lib/monitoring";
import { supabase } from "../lib/supabase";
import {
  initialOverviewState,
  nextOverviewState,
  type OverviewState,
} from "../lib/sites";

const POLL_MS = 30000;
const WATCHED = ["site_risk", "alerts", "lightning_state"];
let sequence = 0;

/**
 * Every site the signed-in user can see, kept current. Like useLive but not keyed by one
 * site: it polls every 30 seconds and refetches when risk, alerts or lightning change.
 */
export function useSiteOverviews(onError?: (message: string) => void): {
  sites: SiteSummary[];
  loaded: boolean;
  error: string | null;
} {
  const [state, setState] = useState<OverviewState>(initialOverviewState);
  const errorRef = useRef(onError);
  const requestRef = useRef(0);
  const aliveRef = useRef(true);
  useEffect(() => {
    errorRef.current = onError;
  });

  const refresh = useCallback(async () => {
    const mine = ++requestRef.current;
    try {
      const sites = await fetchSiteOverviews();
      if (!aliveRef.current || mine !== requestRef.current) return;
      setState((prev) => nextOverviewState(prev, { ok: true, sites }));
    } catch (error) {
      if (!aliveRef.current || mine !== requestRef.current) return;
      const message = errorMessage(error);
      setState((prev) => nextOverviewState(prev, { ok: false, message }));
      errorRef.current?.(message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    aliveRef.current = true;
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
      aliveRef.current = false;
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  return state;
}
