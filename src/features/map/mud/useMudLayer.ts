import { useEffect, useState } from "react";
import type { FeatureCollection } from "geojson";

/** One site's mud layer file, written by reports/next-day/export_mud_layers.py. */
export type MudFile = {
  eia: string;
  label: string;
  model_version: string;
  generated_at: string;
  horizon: { key: string; date: string; label: string };
  default_equipment: string;
  thresholds_in: { inspect: number; hold: number };
  equipment: { key: string; label: string }[];
  caveats: string[];
  routes: FeatureCollection;
};

let indexRequest: Promise<Set<string>> | undefined;

/** Which sites have a mud layer file. Loaded once; a missing index means no site has one. */
function loadIndex(): Promise<Set<string>> {
  indexRequest ??= fetch("/mud/index.json")
    .then((r) => (r.ok ? r.json() : { sites: [] }))
    .then(
      (d: { sites: { eia: string }[] }) => new Set(d.sites.map((s) => s.eia)),
    )
    .catch(() => new Set<string>());
  return indexRequest;
}

/** Whether this site has a mud layer. `false` until the index has loaded. */
export function useHasMud(eia: string | null | undefined): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    let live = true;
    setHas(false);
    if (eia) void loadIndex().then((set) => live && setHas(set.has(eia)));
    return () => {
      live = false;
    };
  }, [eia]);
  return has;
}

export type MudState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; file: MudFile };

/** Loads the site's mud file once the layer is turned on. */
export function useMudFile(
  eia: string | null | undefined,
  enabled: boolean,
): MudState {
  const [state, setState] = useState<MudState>({ status: "idle" });
  useEffect(() => {
    if (!eia || !enabled) {
      setState({ status: "idle" });
      return;
    }
    const ctl = new AbortController();
    setState({ status: "loading" });
    fetch(`/mud/${encodeURIComponent(eia)}.json`, { signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<MudFile>) : Promise.reject()))
      .then(
        (file) => !ctl.signal.aborted && setState({ status: "ready", file }),
      )
      .catch(() => !ctl.signal.aborted && setState({ status: "error" }));
    return () => ctl.abort();
  }, [eia, enabled]);
  return state;
}
