import { useEffect, useState } from "react";

const STEP_MS = 650;
const HOLD_MS = 1500;

/**
 * Current frame plus a play loop that steps forward and holds on the last
 * frame before starting over. Playback never starts by itself.
 */
export function usePlayback(count: number) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing || count < 2) return;
    const last = count - 1;
    const timer = setTimeout(
      () => setIndex((current) => (current >= last ? 0 : current + 1)),
      index >= last ? HOLD_MS : STEP_MS,
    );
    return () => clearTimeout(timer);
  }, [playing, count, index]);

  return { index, setIndex, playing, setPlaying };
}
