// River gauge readings. NOAA NWPS gives the observed stage with the flood stage; USGS is the fallback.
interface NwpsGauge {
  flood?: { categories?: { minor?: { stage?: number } } };
  status?: {
    observed?: {
      primary?: number;
      primaryUnit?: string;
      floodCategory?: string;
    };
  };
}

const UNDEFINED = -900;

export function parseNwps(body: NwpsGauge): {
  stage: number | null;
  floodStage: number | null;
  inFlood: boolean;
} {
  const obs = body.status?.observed;
  const stage =
    obs &&
    obs.primaryUnit === "ft" &&
    typeof obs.primary === "number" &&
    obs.primary > UNDEFINED
      ? obs.primary
      : null;
  const minor = body.flood?.categories?.minor?.stage;
  const floodStage =
    typeof minor === "number" && minor > UNDEFINED ? minor : null;
  return {
    stage,
    floodStage,
    inFlood: ["minor", "moderate", "major"].includes(obs?.floodCategory ?? ""),
  };
}

interface UsgsBody {
  value?: {
    timeSeries?: {
      sourceInfo?: { siteCode?: { value: string }[] };
      values?: { value?: { value: string }[] }[];
    }[];
  };
}

export function parseUsgs(body: UsgsBody): Map<string, number> {
  const out = new Map<string, number>();
  for (const ts of body.value?.timeSeries ?? []) {
    const id = ts.sourceInfo?.siteCode?.[0]?.value;
    const last = ts.values?.[0]?.value?.at(-1)?.value;
    const stage = Number(last);
    if (id && last !== undefined && Number.isFinite(stage) && stage > UNDEFINED)
      out.set(id, stage);
  }
  return out;
}
