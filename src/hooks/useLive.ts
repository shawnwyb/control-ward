import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/format";
import { supabase } from "../lib/supabase";

let sequence = 0;

/**
 * Loads data with `load`, then reloads when any watched table changes for the site, with a polling fallback.
 * The same pattern as useSiteFeed, kept generic so each panel can own one query.
 */
export function useLive<T>(
  siteId: string,
  tables: string[],
  load: (siteId: string) => Promise<T>,
  initial: T,
  pollMs = 60000,
  onError?: (message: string) => void,
) {
  const [data, setData] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const loadRef = useRef(load);
  const errorRef = useRef(onError);
  const initialRef = useRef(initial);
  const tablesKey = tables.join(",");
  useEffect(() => {
    loadRef.current = load;
    errorRef.current = onError;
  });

  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current(siteId));
      setLoaded(true);
      setFailed(false);
    } catch (error) {
      setFailed(true);
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
    setData(initialRef.current);
    setLoaded(false);
    setFailed(false);
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
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [siteId, tablesKey, pollMs, refresh]);

  return { data, loaded, failed, refresh };
}
