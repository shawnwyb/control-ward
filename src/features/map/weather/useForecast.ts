import { useCallback, useEffect, useState } from "react";
import type { Site } from "../../../lib/types";
import { fetchForecastGrid, type ForecastGrid } from "./forecast";
import { usePlayback } from "./usePlayback";

type Status = "idle" | "loading" | "ready" | "error";

/**
 * The hourly forecast grid for a site. Fetched on first use (and cached by
 * `fetchForecastGrid`), so the default map makes no forecast requests.
 */
export function useForecast(site: Site, enabled: boolean) {
  const [status, setStatus] = useState<Status>("idle");
  const [grid, setGrid] = useState<ForecastGrid>();
  // The map now outlives a site switch, so remember whose grid this is.
  const [gridSite, setGridSite] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const playback = usePlayback(grid?.times.length ?? 0);
  const { setIndex, setPlaying } = playback;

  useEffect(() => {
    if (!enabled) {
      setPlaying(false);
      return;
    }
    if (grid && attempt === 0 && gridSite === site.id) {
      setStatus("ready");
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    fetchForecastGrid(site, controller.signal)
      .then((next) => {
        setGrid(next);
        setGridSite(site.id);
        setIndex(0); // "now"
        setStatus("ready");
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn("Forecast unavailable:", error);
          setStatus("error");
        }
      });
    return () => controller.abort();
    // `grid` and `gridSite` are deliberately not dependencies: a loaded grid should not refetch.
  }, [enabled, attempt, site, setIndex, setPlaying]);

  const retry = useCallback(() => {
    setGrid(undefined);
    setAttempt((count) => count + 1);
  }, []);
  return { status, grid, ...playback, retry };
}
