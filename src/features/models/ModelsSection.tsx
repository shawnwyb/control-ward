import { cx } from "../../components/ui";
import { useLive } from "../../hooks/useLive";
import { timeAgo } from "../../lib/format";
import {
  fetchMlScores,
  type MlScore,
  type MlScores,
} from "../../lib/monitoring";
import type {
  HazardIndexSection,
  MudSection,
  ReportResult,
} from "../../lib/nextDayReport";
import { formatReportDate } from "../../lib/nextDayReport";
import type { Site } from "../../lib/types";
import { useReport } from "../nextday/useReport";
import { Gauge, RouteArt, scoreFlag, WARNING_AT, WATCH_AT } from "./ModelArt";
import { HazardIndexFlow, MudFlow } from "./ModelFlow";
import styles from "./ModelsSection.module.css";

const FAMILY: Record<string, string> = {
  heat: "Heat",
  storm: "Storm",
  flood: "Flood",
  fire: "Fire",
};

const INPUTS: Record<string, { label: string; unit: string }> = {
  wbgt_max_f: { label: "WBGT max", unit: "°F" },
  heat_index_max_f: { label: "Heat index max", unit: "°F" },
  gust_max_mph: { label: "Gust max", unit: "mph" },
  rain_24h_mm: { label: "Rain, 24 h", unit: "mm" },
  rain_prev_7d_mm: { label: "Rain, prior 7 d", unit: "mm" },
};

const FLAG_LABEL = { ok: "OK", inspect: "Inspect", hold: "Hold" } as const;

const percent = (p: number) => `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}%`;

const feet = (ft: number) =>
  ft >= 5280 ? `${(ft / 5280).toFixed(1)} mi` : `${Math.round(ft)} ft`;

/** The flag a rut depth earns against the inspect and hold thresholds. */
function rutFlag(inches: number, inspect: number, hold: number) {
  if (inches >= hold) return "hold";
  if (inches >= inspect) return "inspect";
  return "ok";
}

function tierClass(score: number) {
  if (score >= WARNING_AT) return styles.high;
  if (score >= WATCH_AT) return styles.mid;
  return styles.low;
}

const TIER_NAME = { ok: "low", inspect: "watch", hold: "warning" } as const;

/** Why the daily report's breakdown is missing for this site, or null when it is there. */
function missing(result: ReportResult | null, eia: string | null) {
  if (!eia) return "This site has no daily report.";
  if (!result) return "Loading the daily report…";
  if (result.kind === "none")
    return "No daily report has been built for this site yet.";
  if (result.kind === "error") return result.message;
  return null;
}

/** Where the headline score came from: the ml_scores row, and how fresh it is. */
function ScoreSource({ ml }: { ml: MlScore | undefined }) {
  if (!ml) return null;
  return (
    <p className={styles.meta}>
      ML score · {ml.horizon} · updated {timeAgo(ml.computedAt)} ·{" "}
      {ml.modelVersion}
    </p>
  );
}

/** The 0-10 score in big type, coloured by tier, with the tier name. */
function Reading({ score, tier }: { score: number; tier?: string }) {
  return (
    <p className={styles.reading}>
      <strong className={tierClass(score)}>{score.toFixed(1)}</strong>{" "}
      {tier ?? TIER_NAME[scoreFlag(score)]}
    </p>
  );
}

function HazardIndexCard({
  hi,
  ml,
  why,
}: {
  hi: HazardIndexSection | null;
  ml: MlScore | undefined;
  why: string | null;
}) {
  const ok = hi && hi.status === "ok" && hi.score !== undefined;
  // The ml_scores row is the live score; the report's own score is the fallback.
  const score = ml?.score ?? (ok ? hi.score : undefined);
  const probs = ok && hi.probabilities ? Object.entries(hi.probabilities) : [];
  const max = Math.max(...probs.map(([, p]) => p), 0.0001);
  return (
    <article className={styles.card} aria-labelledby="model-hi-title">
      <header>
        <h3 id="model-hi-title" className={styles.title}>
          Hazard Index
        </h3>
        <p className={styles.desc}>
          One calibrated model per hazard family: heat, storm, flood, fire.
        </p>
      </header>

      <Gauge value={score} />
      {score !== undefined ? (
        <Reading score={score} tier={ml ? undefined : hi?.tier} />
      ) : null}

      {ok ? (
        <>
          {hi.top_driver_text ? (
            <p className={styles.driver}>
              Largest driver: <strong>{hi.top_driver_text}</strong>
            </p>
          ) : null}

          <h4 className={styles.sub}>Chance of a recorded event</h4>
          <ul className={styles.bars}>
            {probs.map(([k, p]) => (
              <li key={k} className={styles.bar}>
                <span>{FAMILY[k] ?? k}</span>
                <span className={styles.track} aria-hidden="true">
                  <span
                    className={cx(
                      styles.fill,
                      k === hi.top_driver && styles.fillTop,
                    )}
                    style={{ width: `${(p / max) * 100}%` }}
                  />
                </span>
                <span className={styles.mono}>{percent(p)}</span>
              </li>
            ))}
          </ul>

          {hi.inputs ? (
            <>
              <h4 className={styles.sub}>Forecast inputs</h4>
              <dl className={styles.stats}>
                {Object.entries(hi.inputs).map(([k, v]) => (
                  <div key={k}>
                    <dt>{INPUTS[k]?.label ?? k}</dt>
                    <dd>
                      {v.toFixed(1)} {INPUTS[k]?.unit}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}
        </>
      ) : (
        <p className={styles.empty}>
          {score === undefined
            ? "No hazard index score for this site yet."
            : `The breakdown by hazard family comes with the daily report. ${why ?? hi?.reason ?? ""}`}
        </p>
      )}

      <code className={styles.chip}>
        NOAA Storm Events × OSHA severity → 0–10
      </code>

      <div className={styles.explain}>
        <h4 className={styles.sub}>How it works</h4>
        <HazardIndexFlow
          score={score}
          probabilities={ok ? hi.probabilities : undefined}
          topDriver={ok ? hi.top_driver : undefined}
        />
        <p>
          Each hazard family has its own model. It estimates the chance that
          NOAA records a severe event of that kind near the plant tomorrow,
          using the forecast inputs above. Each chance is weighted by how often
          OSHA severe injury reports follow that kind of event, and the sum is
          scaled from 0 to 10. About {WATCH_AT} is a watch, {WARNING_AT} a
          warning and 10 stop work.
        </p>
        {ok && hi.caveats?.length ? (
          <ul>
            {hi.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : null}
        {ml ? (
          <ScoreSource ml={ml} />
        ) : ok && hi.model_version ? (
          <p className={styles.meta}>Model {hi.model_version}</p>
        ) : null}
      </div>
    </article>
  );
}

function MudCard({
  mud,
  ml,
  why,
}: {
  mud: MudSection | null;
  ml: MlScore | undefined;
  why: string | null;
}) {
  const ok = mud && mud.status === "ok" && mud.equipment?.length;
  const inspect = mud?.thresholds_in?.inspect ?? 4;
  const hold = mud?.thresholds_in?.hold ?? 8;
  // The rut scale runs a little past "hold" so a hold reading still shows room.
  const scale = hold * 1.25;
  const counts = mud?.segment_counts;
  // The cart takes the worst flag of the report's default equipment (road trucks).
  const cartFlag = (
    mud?.equipment?.find((e) => e.key === mud.default_equipment) ??
    mud?.equipment?.[0]
  )?.worst_flag;
  const total = counts ? counts.ok + counts.inspect + counts.hold : 0;
  return (
    <article className={styles.card} aria-labelledby="model-mud-title">
      <header>
        <h3 id="model-mud-title" className={styles.title}>
          Mud trafficability
        </h3>
        <p className={styles.desc}>
          STRAM-inspired rutting forecast for unpaved routes.
        </p>
      </header>

      <RouteArt
        counts={ok && counts ? counts : undefined}
        cart={ok ? cartFlag : undefined}
        score={ml?.score}
      />
      {ml ? <Reading score={ml.score} /> : null}

      {ok ? (
        <>
          {mud.horizon ? (
            <dl className={styles.stats}>
              <div>
                <dt>Forecast day</dt>
                <dd>{formatReportDate(mud.horizon.date)}</dd>
              </div>
              <div>
                <dt>Rain</dt>
                <dd>{mud.horizon.rain_in.toFixed(2)} in</dd>
              </div>
              <div>
                <dt>Soil moisture</dt>
                <dd>{Math.round(mud.horizon.soil_moisture * 100)}%</dd>
              </div>
              <div>
                <dt>Passes</dt>
                <dd>{mud.passes ?? 1}</dd>
              </div>
            </dl>
          ) : null}

          {counts && total ? (
            <>
              <h4 className={styles.sub}>Route segments ({total})</h4>
              <div
                className={styles.stack}
                role="img"
                aria-label={`${counts.ok} OK, ${counts.inspect} to inspect, ${counts.hold} on hold`}
              >
                {(["ok", "inspect", "hold"] as const).map((f) =>
                  counts[f] ? (
                    <span
                      key={f}
                      className={styles[f]}
                      style={{ flexGrow: counts[f] }}
                    />
                  ) : null,
                )}
              </div>
              <ul className={styles.legend}>
                {(["ok", "inspect", "hold"] as const).map((f) => (
                  <li key={f}>
                    <i className={styles[f]} aria-hidden="true" />
                    {FLAG_LABEL[f]}{" "}
                    <span className={styles.mono}>{counts[f]}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <h4 className={styles.sub}>Rut score by equipment</h4>
          <ul className={styles.equipment}>
            {mud.equipment!.map((e) => (
              <li key={e.key}>
                <div className={styles.equipHead}>
                  <span>{e.label}</span>
                  <span className={cx(styles.flag, styles[e.worst_flag])}>
                    {FLAG_LABEL[e.worst_flag]}
                  </span>
                </div>
                <span className={styles.rut} aria-hidden="true">
                  <span
                    className={cx(
                      styles.rutFill,
                      styles[rutFlag(e.score, inspect, hold)],
                    )}
                    style={{
                      width: `${Math.min(100, (e.score / scale) * 100)}%`,
                    }}
                  />
                  <i style={{ left: `${(inspect / scale) * 100}%` }} />
                  <i style={{ left: `${(hold / scale) * 100}%` }} />
                </span>
                <p className={styles.equipMeta}>
                  <span className={styles.mono}>
                    rut score {e.score.toFixed(1)} in
                  </span>{" "}
                  · {feet(e.flagged_route_ft)} of {feet(e.route_ft)} flagged
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.empty}>
          {ml
            ? `Segment and equipment detail comes with the daily report. ${why ?? mud?.reason ?? ""}`
            : "No mud trafficability score for this site yet."}
        </p>
      )}

      <code className={styles.chip}>
        SSURGO soil · 3DEP terrain · OSM routes · Open-Meteo
      </code>

      <div className={styles.explain}>
        <h4 className={styles.sub}>How it works</h4>
        <MudFlow
          counts={ok && counts ? counts : undefined}
          score={ml?.score}
          inspectIn={inspect}
          holdIn={hold}
        />
        <p>
          Every unpaved route near the site is split into segments. For each
          one, the model reads soil type from SSURGO, slope from 3DEP and the
          forecast rain and soil moisture from Open-Meteo. It then estimates how
          deep each kind of equipment would rut. Over {inspect} in a segment is
          flagged to inspect; over {hold} in it is on hold.
        </p>
        <p>
          Uncalibrated: it flags segments to inspect, not a crossing clearance.
        </p>
        {ok && mud.caveats?.length ? (
          <ul>
            {mud.caveats.slice(1).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : null}
        {ml ? (
          <ScoreSource ml={ml} />
        ) : ok && mud.model_version ? (
          <p className={styles.meta}>Model {mud.model_version}</p>
        ) : null}
      </div>
    </article>
  );
}

const noScores: MlScores = {};

/**
 * The two forecast models for the selected site. The 0-10 scores come live from
 * ml_scores; the breakdown under them comes from the site's newest daily report.
 */
export function ModelsSection({ site }: { site: Site }) {
  const eia = site.eia_plant_id;
  const result = useReport(eia);
  const ml = useLive(site.id, ["ml_scores"], fetchMlScores, noScores, 60000);
  const why = missing(result, eia);
  const report = result?.kind === "ok" ? result.report : null;
  return (
    <section className={styles.section} aria-labelledby="models-title">
      <h2 id="models-title" className={styles.heading}>
        Forecast models
      </h2>
      <p className={styles.lede}>
        Tomorrow at {site.name}, from the two models behind the daily safety
        briefing.
      </p>
      <div className={styles.grid}>
        <HazardIndexCard
          key={`hi-${site.id}`}
          hi={report?.hazard_index ?? null}
          ml={ml.data.hazard_index}
          why={why}
        />
        <MudCard
          key={`mud-${site.id}`}
          mud={report?.mud ?? null}
          ml={ml.data.mud}
          why={why}
        />
      </div>
    </section>
  );
}
