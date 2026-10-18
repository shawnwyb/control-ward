/*
 * Hazard index bands. Kept free of imports (no Supabase client) so plain
 * Node tests can load it; monitoring.ts re-exports both functions.
 */

/** Heat, rain, wind and storms at a glance. Matches the rules engine's 0 to 10 scale. */
export function riskLevel(risk: number | null): {
  label: string;
  tone: "ok" | "caution" | "danger" | "unknown";
} {
  if (risk === null) return { label: "No data", tone: "unknown" };
  if (risk >= 7) return { label: "High", tone: "danger" };
  if (risk >= 4) return { label: "Elevated", tone: "caution" };
  return { label: "Low", tone: "ok" };
}

/** The same bands as riskLevel, named for the Notion tag palette. */
export function riskTone(
  risk: number | null,
): "high" | "elevated" | "low" | "none" {
  const { tone } = riskLevel(risk);
  if (tone === "danger") return "high";
  if (tone === "caution") return "elevated";
  if (tone === "ok") return "low";
  return "none";
}
