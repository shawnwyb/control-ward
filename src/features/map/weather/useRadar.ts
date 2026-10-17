import { useCallback, useEffect, useState } from "react";
import { fetchRadarFrames } from "./radar";
import { usePlayback } from "./usePlayback";

type Status = "idle" | "loading" | "ready" | "error";

/**
 * Radar frames for the map. Loads only while the overlay is on, so the default
 * map makes no weather requests.
 */
export function useRadar(enabled: boolean) {
  const [status, setStatus] = useState<Status>("idle");
  const [frames, setFrames] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const playback = usePlayback(frames.length);
  const { setIndex, setPlaying } = playback;

  useEffect(() => {
    if (!enabled) {
      setPlaying(false);
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    fetchRadarFrames(controller.signal)
      .then((next) => {
        setFrames(next);
        setIndex(next.length - 1); // start on the newest frame
        setStatus("ready");
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn("Radar unavailable:", error);
          setStatus("error");
        }
      });
    return () => controller.abort();
  }, [enabled, attempt, setIndex, setPlaying]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { status, frames, ...playback, retry };
}
