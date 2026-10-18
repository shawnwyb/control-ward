import { useEffect, useState } from "react";
import {
  conditionsUrl,
  parseConditions,
  type Conditions,
} from "../lib/conditions";
import { liveView, requestGate, type LiveState } from "../lib/live";

const REFRESH_MS = 10 * 60 * 1000;

type Held = LiveState<Conditions | null> & { at: number };

/**
 * Current weather numbers at the site, refreshed every 10 minutes and on a site change.
 * Aborts on unmount or switch and drops a late answer for a site the user has left.
 */
export function useConditions(site: {
  id: string;
  latitude: number;
  longitude: number;
}) {
  const { id, latitude, longitude } = site;
  const [state, setState] = useState<Held>({
    siteId: id,
    data: null,
    loaded: false,
    failed: false,
    at: 0,
  });
  useEffect(() => {
    const gate = requestGate(id);
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      const current = gate.start(id);
      try {
        const res = await fetch(conditionsUrl(latitude, longitude), {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
        const data = parseConditions(await res.json());
        if (!data) throw new Error("Open-Meteo sent no current conditions");
        if (current())
          setState({
            siteId: id,
            data,
            loaded: true,
            failed: false,
            at: Date.now(),
          });
      } catch (e) {
        if (!current() || (e as Error).name === "AbortError") return;
        setState((s) => ({
          siteId: id,
          data: s.siteId === id ? s.data : null,
          loaded: true,
          failed: true,
          at: s.siteId === id ? s.at : 0,
        }));
      }
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      clearInterval(timer);
      gate.select("");
      controller?.abort();
    };
  }, [id, latitude, longitude]);
  const view = liveView<Conditions | null>(state, id, null);
  return {
    conditions: view.data,
    loaded: view.loaded,
    error: view.failed && view.data === null,
    updatedAt: view === state ? state.at : 0,
  };
}
