import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { errorMessage } from "../../lib/format";
import {
  acknowledgeAlert,
  emptyMonitoring,
  fetchMonitoring,
  markBriefingRead,
  type MonitoringSnapshot,
} from "../../lib/monitoring";
import { supabase } from "../../lib/supabase";

// Unique topics keep React StrictMode's mount/unmount/mount from colliding on one channel.
let channelSequence = 0;

/** Tables whose changes should refresh the alerts, risk and briefing. */
const WATCHED = [
  "alerts",
  "lightning_state",
  "site_risk",
  "briefings",
] as const;

/**
 * Alerts, site risk and the evening briefing for one site. Realtime changes
 * refresh it, with a one-minute poll as a fallback. A failed refresh keeps
 * the last good data and reports the error once, not on every retry.
 */
export function useMonitoring(
  siteId: string,
  userId: string,
  onError: (message: string) => void,
) {
  const [snapshot, setSnapshot] = useState<MonitoringSnapshot>(emptyMonitoring);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const versionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reportedRef = useRef(false);
  const requestIds = useRef(new Map<string, string>());
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  const refresh = useCallback(async () => {
    const version = ++versionRef.current;
    try {
      const next = await fetchMonitoring(siteId, userId);
      if (version !== versionRef.current) return; // a newer refresh superseded this one
      setSnapshot(next);
      setLoaded(true);
      setFailed(false);
      reportedRef.current = false;
    } catch (error) {
      if (version !== versionRef.current) return;
      setFailed(true);
      if (!reportedRef.current) {
        reportedRef.current = true;
        onErrorRef.current(errorMessage(error));
      }
    }
  }, [siteId, userId]);

  const scheduleRefresh = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void refresh(), 150);
  }, [refresh]);

  useEffect(() => {
    versionRef.current++;
    setSnapshot(emptyMonitoring);
    setLoaded(false);
    setFailed(false);
    void refresh();
    let channel: RealtimeChannel = supabase.channel(
      `monitor-${siteId}-${++channelSequence}`,
    );
    for (const table of WATCHED)
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `site_id=eq.${siteId}` },
        scheduleRefresh,
      );
    channel.subscribe();
    const interval = setInterval(() => {
      if (!document.hidden) scheduleRefresh();
    }, 60000);
    return () => {
      versionRef.current++;
      clearTimeout(timerRef.current);
      clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [siteId, refresh, scheduleRefresh]);

  /** Acknowledge an alert. A retry after a lost response reuses the same request id. */
  const acknowledge = useCallback(
    async (alertId: string) => {
      const requestId = requestIds.current.get(alertId) ?? crypto.randomUUID();
      requestIds.current.set(alertId, requestId);
      setPending((current) => new Set(current).add(alertId));
      try {
        await acknowledgeAlert(requestId, alertId);
        requestIds.current.delete(alertId);
        setSnapshot((current) => ({
          ...current,
          acknowledged: new Set(current.acknowledged).add(alertId),
        }));
        void refresh();
      } catch (error) {
        onErrorRef.current(
          `${errorMessage(error)} Your acknowledgement was not saved; try again.`,
        );
      } finally {
        setPending((current) => {
          const next = new Set(current);
          next.delete(alertId);
          return next;
        });
      }
    },
    [refresh],
  );

  const markRead = useCallback(async (briefingId: string) => {
    try {
      await markBriefingRead(briefingId);
      setSnapshot((current) => ({ ...current, briefingRead: true }));
    } catch (error) {
      onErrorRef.current(
        `${errorMessage(error)} The briefing was not marked as read; try again.`,
      );
    }
  }, []);

  return {
    ...snapshot,
    loaded,
    failed,
    pending,
    acknowledge,
    markRead,
    retry: refresh,
  };
}
