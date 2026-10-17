import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/format";
import { acknowledgeAlert, fetchAcknowledged } from "../lib/monitoring";

/**
 * Which alerts this user has acknowledged, and a way to acknowledge one.
 * A retry after a lost response reuses the same request id.
 */
export function useAcknowledgements(
  alertIds: string[],
  userId: string,
  onError: (message: string) => void,
) {
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const requestIds = useRef(new Map<string, string>());
  const errorRef = useRef(onError);
  useEffect(() => {
    errorRef.current = onError;
  });
  const key = alertIds.join(",");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetchAcknowledged(key.split(","), userId)
      .then(
        (found) =>
          !cancelled &&
          setAcknowledged((current) => new Set([...current, ...found])),
      )
      .catch((error) => !cancelled && errorRef.current(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [key, userId]);

  const acknowledge = useCallback(async (alertId: string) => {
    const requestId = requestIds.current.get(alertId) ?? crypto.randomUUID();
    requestIds.current.set(alertId, requestId);
    setPending((current) => new Set(current).add(alertId));
    try {
      await acknowledgeAlert(requestId, alertId);
      requestIds.current.delete(alertId);
      setAcknowledged((current) => new Set(current).add(alertId));
    } catch (error) {
      errorRef.current(
        `${errorMessage(error)} Your acknowledgement was not saved; try again.`,
      );
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(alertId);
        return next;
      });
    }
  }, []);

  return { acknowledged, pending, acknowledge };
}
