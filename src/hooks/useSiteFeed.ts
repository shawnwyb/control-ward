import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  emptySnapshot,
  fetchSiteSnapshot,
  type SiteSnapshot,
} from "../lib/api";
import { errorMessage } from "../lib/format";
import { supabase } from "../lib/supabase";

export type ConnectionState =
  "connecting" | "preparing" | "live" | "unavailable" | "reconnecting";

export const connectionLabels: Record<ConnectionState, string> = {
  connecting: "Connecting to live updates…",
  preparing: "Preparing live updates…",
  live: "Live updates",
  unavailable: "Live feed unavailable · refreshes every minute",
  reconnecting: "Reconnecting · refreshes every minute",
};

// Unique topics keep React StrictMode's mount/unmount/mount from colliding on one channel.
let channelSequence = 0;

/**
 * Loads a site's reports and metrics, then keeps them fresh from realtime
 * changes with a one-minute polling fallback.
 */
export function useSiteFeed(
  siteId: string | undefined,
  onError: (message: string) => void,
) {
  const [snapshot, setSnapshot] = useState<SiteSnapshot>(emptySnapshot);
  const [loaded, setLoaded] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const siteRef = useRef<string | undefined>(undefined);
  const versionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  const refresh = useCallback(async () => {
    const id = siteRef.current;
    if (!id) return;
    const version = ++versionRef.current;
    const next = await fetchSiteSnapshot(id);
    // A newer refresh or a site switch supersedes this response.
    if (siteRef.current !== id || version !== versionRef.current) return;
    setSnapshot(next);
    setLoaded(true);
  }, []);

  const scheduleRefresh = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      refresh().catch((error) => onErrorRef.current(errorMessage(error)));
    }, 150);
  }, [refresh]);

  useEffect(() => {
    siteRef.current = siteId;
    versionRef.current++;
    setSnapshot(emptySnapshot);
    setLoaded(false);
    setConnection("connecting");
    if (!siteId) return;
    let cancelled = false;
    let channel: RealtimeChannel | undefined;
    void (async () => {
      try {
        await refresh();
      } catch (error) {
        if (!cancelled) onErrorRef.current(errorMessage(error));
      }
      if (cancelled) return;
      let changesReady = false;
      setConnection("connecting");
      channel = supabase
        .channel(`site-${siteId}-${++channelSequence}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "hazard_reports",
            filter: `site_id=eq.${siteId}`,
          },
          scheduleRefresh,
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "hazard_checkin_tasks" },
          scheduleRefresh,
        )
        .on("system", {}, (payload) => {
          if (cancelled || payload.extension !== "postgres_changes") return;
          changesReady = payload.status === "ok";
          setConnection(changesReady ? "live" : "unavailable");
          // Reconcile writes that happened between the initial query and replication becoming ready.
          if (changesReady) scheduleRefresh();
        })
        .subscribe((status) => {
          if (cancelled) return;
          if (status !== "SUBSCRIBED") {
            changesReady = false;
            setConnection("reconnecting");
          } else if (!changesReady) setConnection("preparing");
        });
    })();
    const interval = setInterval(() => {
      if (!document.hidden) scheduleRefresh();
    }, 60000);
    return () => {
      cancelled = true;
      siteRef.current = undefined;
      versionRef.current++;
      clearTimeout(timerRef.current);
      clearInterval(interval);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [siteId, refresh, scheduleRefresh]);

  return { ...snapshot, loaded, connection, refresh };
}
