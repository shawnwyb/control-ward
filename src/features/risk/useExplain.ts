import { useReadings } from "../../hooks/useReadings";
import {
  explainHazard,
  scoreDiffers,
  type ExplainSite,
  type Explanation,
  type HazardKind,
} from "../../lib/explain";
import type { LightningView, Subscores } from "../../lib/monitoring";

export type HazardView = {
  /** The score stored by the rules engine; this is the number shown. */
  stored: number;
  /** The explanation recomputed from the readings, once they have loaded. */
  explanation: Explanation | null;
  /** The stored score and the recomputed one are different numbers. */
  stale: boolean;
};

/**
 * Explanations for one site's hazard scores, recomputed from its readings.
 * The stored subscore is always the number shown; a recomputed score that
 * disagrees with it is flagged instead of shown beside it as if it were equal.
 */
export function useExplain(
  site: ExplainSite & { id: string },
  lightning: LightningView,
  subscores: Subscores,
) {
  const readings = useReadings(site.id);
  return (kind: HazardKind): HazardView | null => {
    const stored = subscores[kind];
    if (typeof stored !== "number") return null;
    if (!readings.loaded) return { stored, explanation: null, stale: false };
    const explanation = explainHazard(kind, readings.data, site, {
      lightning,
      wildlifeScore: subscores.wildlife,
    });
    return {
      stored,
      explanation,
      stale: scoreDiffers(stored, explanation.score),
    };
  };
}
