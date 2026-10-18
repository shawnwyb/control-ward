import { useEffect, useState } from "react";

/** The current time in ms, refreshed every second while `active`. Fresh on the render that activates it. */
export function useNow(active: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  // Recomputed on every render (the tick forces one a second), so never a stale frame.
  void tick;
  return Date.now();
}
