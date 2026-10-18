import { useCallback } from "react";
import { useAcknowledgements } from "../../hooks/useAcknowledgements";
import { useNotice } from "../../hooks/notice";
import type { AlertRow, LightningView } from "../../lib/monitoring";
import { clearSupervisorAlert } from "../../lib/monitoring";
import { errorMessage } from "../../lib/format";
import { AlertsPanel } from "./AlertsPanel";
import { AlertsUnavailable } from "./AlertsUnavailable";

type Live<T> = { data: T; failed: boolean; refresh: () => Promise<void> };

/**
 * Alerts for one site, with Acknowledge. If they could not be loaded it says so,
 * because an empty list would look like "no alerts".
 */
export function AlertsSection({
  alerts,
  lightning,
  userId,
  compact,
  canClear,
}: {
  alerts: Live<AlertRow[]>;
  lightning: Live<LightningView>;
  userId: string;
  compact?: boolean;
  /** Supervisors can clear their own messages. */
  canClear?: boolean;
}) {
  const { announce } = useNotice();
  const onError = useCallback((m: string) => announce(m, true), [announce]);
  const ack = useAcknowledgements(
    alerts.data.map((alert) => alert.id),
    userId,
    onError,
  );
  const clear = useCallback(
    async (alertId: string) => {
      try {
        await clearSupervisorAlert(alertId);
        await alerts.refresh();
        announce("Alert cleared.");
      } catch (error) {
        announce(errorMessage(error), true);
      }
    },
    [alerts, announce],
  );
  if (alerts.failed || lightning.failed)
    return (
      <AlertsUnavailable
        onRetry={() => {
          void alerts.refresh();
          void lightning.refresh();
        }}
      />
    );
  return (
    <AlertsPanel
      alerts={alerts.data}
      lightning={lightning.data}
      compact={compact}
      onClear={canClear ? (id) => void clear(id) : undefined}
      acknowledgement={{
        acknowledged: ack.acknowledged,
        pending: ack.pending,
        onAcknowledge: (id) => void ack.acknowledge(id),
      }}
    />
  );
}
