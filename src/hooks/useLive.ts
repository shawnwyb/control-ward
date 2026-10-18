import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/format";
import { liveView, requestGate, type LiveState } from "../lib/live";
import { supabase } from "../lib/supabase";

let sequence = 0;

/**
 * Loads data with `load`, then reloads when any watched table changes for the site, with a polling fallback.
 * The same pattern as useSiteFeed, kept generic so each panel can own one query.
 *
 * The hook survives a site switch, so it never shows one site's data for another:
 * held data is tagged with its site (anything else reads as not loaded yet), and
 * answers for a site that is no longer selected, or for a superseded request, are dropped.
 */
export function useLive<T>(
  siteId: string,
  tables: string[],
  load: (siteId: string) => Promise<T>,
  initial: T,
  pollMs = 60000,
  onError?: (message: string) => void,
) {
  const [state, setState] = useState<LiveState<T>>(() => ({
    siteId,
    data: initial,
    loaded: false,
    failed: false,
  }));
  const gate = useRef(requestGate(siteId));
  const loadRef = useRef(load);
  const errorRef = useRef(onError);
  const initialRef = useRef(initial);
  const tablesKey = tables.join(",");
  useEffect(() => {
    loadRef.current = load;
    errorRef.current = onError;
  });

  const refresh = useCallback(async () => {
    const isCurrent = gate.current.start(siteId);
    try {
      const data = await loadRef.current(siteId);
      if (!isCurrent()) return;
      setState({ siteId, data, loaded: true, failed: false });
    } catch (error) {
      if (!isCurrent()) return;
      // Keep the last good data for this site; just mark the read as failed.
      setState((prev) => ({
        ...liveView(prev, siteId, initialRef.current),
        failed: true,
      }));
      errorRef.current?.(errorMessage(error));
    }
  }, [siteId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => !cancelled && void refresh(), 200);
    };
    // Earlier requests (another site's, or this site's before it was left) no longer land.
    gate.current.select(siteId);
    void refresh();
    let channel = supabase.channel(`live-${tablesKey}-${siteId}-${++sequence}`);
    for (const table of tablesKey.split(",").filter(Boolean))
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `site_id=eq.${siteId}` },
        soon,
      );
    channel.subscribe();
    const interval = setInterval(() => {
      if (!document.hidden) soon();
    }, pollMs);
    // A tab that was hidden skipped its polls, so catch up the moment it is shown again.
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
  }, [siteId, tablesKey, pollMs, refresh]);

  const { data, loaded, failed } = liveView(state, siteId, initialRef.current);
  return { data, loaded, failed, refresh };
}
