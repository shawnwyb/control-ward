// NWS active alerts for one point -> severity (0-4) and whether a flood warning is active.
const SEVERITY: Record<string, number> = {
  Minor: 1,
  Moderate: 2,
  Severe: 3,
  Extreme: 4,
};
const FLOOD_WARNING =
  /^(Flash )?Flood (Warning|Statement)|^Flood Warning|^Coastal Flood Warning/;

interface AlertCollection {
  features?: {
    properties?: { severity?: string; event?: string; status?: string };
  }[];
}

export function summarizeAlerts(body: AlertCollection): {
  severity: number;
  floodWarning: number;
} {
  let severity = 0,
    floodWarning = 0;
  for (const f of body.features ?? []) {
    const p = f.properties ?? {};
    if (p.status && p.status !== "Actual") continue;
    severity = Math.max(severity, SEVERITY[p.severity ?? ""] ?? 0);
    if (FLOOD_WARNING.test(p.event ?? "")) floodWarning = 1;
  }
  return { severity, floodWarning };
}
