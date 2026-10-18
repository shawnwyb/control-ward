import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Badge,
  Button,
  Icon,
  Panel,
  PanelHeader,
  SeverityMark,
  cx,
  TimeSlider,
  type IconName,
} from "../../components/ui";
import { SITE_RADIUS_M } from "../../lib/geo";
import type { CrewMember } from "../../lib/monitoring";
import type { SiteSummary } from "../../lib/sites";
import type { Report, Severity, Site } from "../../lib/types";
import { renderFieldFrames } from "./weather/field";
import {
  OPEN_METEO_CREDIT,
  OPEN_METEO_URL,
  describeForecastHour,
} from "./weather/forecast";
import {
  RADAR_CREDIT,
  describeFrame,
  radarLegendGradient,
} from "./weather/radar";
import {
  MS_TO_MPH,
  PRECIPITATION_RANGE,
  TEMPERATURE_RANGE,
  WIND_RANGE_MPH,
  legendGradient,
  precipitationRamp,
  temperatureRamp,
  windRamp,
} from "./weather/ramps";
import type { WeatherView } from "./weather/types";
import { useForecast } from "./weather/useForecast";
import { useRadar } from "./weather/useRadar";
import styles from "./SiteMap.module.css";

// MapLibre is large; load it after the form and feed have rendered.
const MapCanvas = lazy(() => import("./MapCanvas"));

type Overlay = "off" | "rain" | "wind" | "temperature";
type RainSource = "radar" | "forecast";

const layerChips: {
  value: Exclude<Overlay, "off">;
  label: string;
  icon: IconName;
}[] = [
  { value: "rain", label: "Rain", icon: "rain" },
  { value: "wind", label: "Wind", icon: "wind" },
  { value: "temperature", label: "Temperature", icon: "heat" },
];
const sourceChips: { value: RainSource; label: string; ariaLabel: string }[] = [
  { value: "radar", label: "Radar", ariaLabel: "Radar, past 2 hours" },
  {
    value: "forecast",
    label: "Forecast",
    ariaLabel: "Forecast, next 12 hours",
  },
];

type Props = {
  site: Site;
  reports: Report[];
  crew?: CrewMember[];
  crewFocus?: { id: string; nonce: number };
  pin: { latitude: number; longitude: number };
  disabled: boolean;
  className?: string;
  highlightId?: string | null;
  focusRequest?: { id: string; nonce: number };
  /** Supervisors' Sites page: every site as a score pin; clicking one selects it. */
  sites?: SiteSummary[];
  onSelectSite?: (siteId: string) => void;
  /** The selected site is in lightning stop-work. */
  stopWork?: boolean;
  /** Frame the whole stop-work ring once per stop-work episode. */
  fitStopWork?: boolean;
  /**
   * "card" (default): titled panel with the legend below. "fill": the map fills its
   * container edge to edge, with the legend in a small popover.
   */
  variant?: "card" | "fill";
  onPin: (latitude: number, longitude: number) => void;
};

/** What the legend under the scrubber says about the active overlay. */
type Key = {
  from: string;
  to: string;
  gradient: string;
  credit: "radar" | "open-meteo";
};

const mph = (value: number) => Math.round(value);

function keyFor(overlay: Overlay, source: RainSource): Key | null {
  if (overlay === "rain" && source === "radar")
    return {
      from: "Light",
      to: "Heavy",
      gradient: radarLegendGradient,
      credit: "radar",
    };
  if (overlay === "rain")
    return {
      from: "Light",
      to: "Heavy",
      gradient: legendGradient(precipitationRamp, ...PRECIPITATION_RANGE),
      credit: "open-meteo",
    };
  if (overlay === "temperature")
    return {
      from: `${TEMPERATURE_RANGE[0]}°F`,
      to: `${TEMPERATURE_RANGE[1]}°F`,
      gradient: legendGradient(temperatureRamp, ...TEMPERATURE_RANGE),
      credit: "open-meteo",
    };
  if (overlay === "wind")
    return {
      from: `${mph(WIND_RANGE_MPH[0])} mph`,
      to: `${mph(WIND_RANGE_MPH[1])} mph`,
      gradient: legendGradient(
        windRamp,
        WIND_RANGE_MPH[0] / MS_TO_MPH,
        WIND_RANGE_MPH[1] / MS_TO_MPH,
      ),
      credit: "open-meteo",
    };
  return null;
}

export function SiteMap({
  site,
  reports,
  crew,
  crewFocus,
  pin,
  disabled,
  className,
  highlightId,
  focusRequest,
  sites,
  onSelectSite,
  stopWork = false,
  fitStopWork = false,
  variant = "card",
  onPin,
}: Props) {
  const [unavailable, setUnavailable] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>("off");
  const [rainSource, setRainSource] = useState<RainSource>("radar");
  const [legendOpen, setLegendOpen] = useState(false);
  const legendId = useId();
  const legendBox = useRef<HTMLDivElement>(null);
  const legendButton = useRef<HTMLButtonElement>(null);
  // The legend popover closes on Escape (focus returns to its button) and on a click elsewhere.
  useEffect(() => {
    if (!legendOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setLegendOpen(false);
      legendButton.current?.focus();
    };
    const onDown = (event: PointerEvent) => {
      if (!legendBox.current?.contains(event.target as Node))
        setLegendOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [legendOpen]);
  const fill = variant === "fill";

  const radarOn = overlay === "rain" && rainSource === "radar";
  const forecastOn = overlay !== "off" && !radarOn;
  const radar = useRadar(radarOn);
  const forecast = useForecast(site, forecastOn);

  // Colour-field images are painted once per variable, not on every frame change.
  const variable = overlay === "temperature" ? "temperature" : "precipitation";
  const fieldFrames = useMemo(
    () =>
      forecastOn && overlay !== "wind" && forecast.grid
        ? renderFieldFrames(forecast.grid, variable)
        : null,
    [forecastOn, overlay, forecast.grid, variable],
  );

  const weather = useMemo<WeatherView | null>(() => {
    if (radarOn && radar.status === "ready")
      return { kind: "radar", frames: radar.frames, index: radar.index };
    if (!forecastOn || forecast.status !== "ready" || !forecast.grid)
      return null;
    if (overlay === "wind")
      return { kind: "wind", grid: forecast.grid, index: forecast.index };
    return fieldFrames
      ? {
          kind: "field",
          variable,
          images: fieldFrames.images,
          coordinates: fieldFrames.coordinates,
          index: forecast.index,
        }
      : null;
  }, [
    radarOn,
    forecastOn,
    overlay,
    variable,
    radar.status,
    radar.frames,
    radar.index,
    forecast.status,
    forecast.grid,
    forecast.index,
    fieldFrames,
  ]);

  // One scrubber serves whichever source is active.
  const source = radarOn ? radar : forecastOn ? forecast : null;
  const sourceName = radarOn ? "Radar" : "Forecast";
  const count = radarOn
    ? radar.frames.length
    : (forecast.grid?.times.length ?? 0);
  const ready = source?.status === "ready" && count > 0;
  const valueText = !ready
    ? ""
    : radarOn
      ? describeFrame(radar.frames[radar.index])
      : describeForecastHour(forecast.grid!.times[forecast.index]);
  const key = keyFor(overlay, rainSource);

  const weatherEl = (
    <>
      {source ? (
        <div className={cx(styles.weather, fill && styles.weatherFloat)}>
          {source.status === "loading" ? (
            <p className={styles.weatherNote}>
              Loading {sourceName.toLowerCase()}…
            </p>
          ) : null}
          {source.status === "error" ? (
            <p className={styles.weatherNote}>
              {sourceName} isn’t available right now.{" "}
              <Button variant="ghost" onClick={source.retry}>
                Try again
              </Button>
            </p>
          ) : null}
          {ready ? (
            <>
              <TimeSlider
                label={radarOn ? "radar loop" : "forecast"}
                value={source.index}
                max={count - 1}
                valueText={valueText}
                playing={source.playing}
                onChange={(value) => {
                  source.setPlaying(false);
                  source.setIndex(value);
                }}
                onTogglePlay={() => source.setPlaying(!source.playing)}
              />
              {key ? (
                <div className={styles.radarKey}>
                  <span>{key.from}</span>
                  <span
                    className={styles.ramp}
                    style={{ background: key.gradient }}
                    aria-hidden="true"
                  />
                  <span>{key.to}</span>
                  <span className={styles.credit}>
                    {key.credit === "radar" ? (
                      RADAR_CREDIT
                    ) : (
                      <a href={OPEN_METEO_URL} target="_blank" rel="noopener">
                        {OPEN_METEO_CREDIT}
                      </a>
                    )}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
  const legendEl = (
    <ul
      id={fill ? legendId : undefined}
      className={cx(styles.legend, fill && styles.legendPop)}
    >
      <li>
        <span className={styles.pinSample} aria-hidden="true" />
        Your pin
      </li>
      {crew ? (
        <li>
          <span className={styles.crewSample} aria-hidden="true" />
          Worker (last known)
        </li>
      ) : null}
      {([1, 2, 3] as Severity[]).map((severity) => (
        <li key={severity}>
          <SeverityMark severity={severity} size={14} />
          {["", "Low", "Moderate", "High"][severity]}
        </li>
      ))}
      <li className={styles.note}>
        Dashed ring: {SITE_RADIUS_M} m from site center
      </li>
      {sites ? (
        <li className={styles.note}>Pins: each site’s hazard index, 0 to 10</li>
      ) : null}
      {stopWork ? (
        <li className={styles.note}>
          <span className={styles.stormSample} aria-hidden="true" />
          Orange ring: lightning stop-work, 10 miles
        </li>
      ) : null}
      <li className={`${styles.note} ${styles.keyboardHint}`}>
        With the map focused, arrow keys move the pin (Shift for 100 m).
      </li>
    </ul>
  );

  return (
    <Panel
      id="site-map"
      className={cx(className, fill && styles.fillPanel)}
      aria-labelledby={fill ? undefined : "map-title"}
      aria-label={fill ? `${site.name} map` : undefined}
    >
      {fill ? null : (
        <PanelHeader
          title={site.name}
          titleId="map-title"
          aside={<Badge>1200 m × 800 m</Badge>}
        />
      )}
      {unavailable ? (
        <div className={styles.placeholder}>
          The map isn’t available on this device. Use “Use my location” or enter
          coordinates.
        </div>
      ) : (
        <div className={cx(styles.stage, fill && styles.stageFill)}>
          <Suspense
            fallback={<div className={styles.placeholder}>Loading map…</div>}
          >
            <MapCanvas
              site={site}
              reports={reports}
              crew={crew}
              crewFocus={crewFocus}
              pin={pin}
              disabled={disabled}
              highlightId={highlightId}
              focusRequest={focusRequest}
              weather={weather}
              regional={overlay !== "off"}
              sites={sites}
              onSelectSite={onSelectSite}
              stopWork={stopWork}
              fitStopWork={fitStopWork}
              fill={fill}
              onPin={onPin}
              onUnavailable={() => setUnavailable(true)}
            />
          </Suspense>
          {/* Weather layers float over the map as chips; pressing the active one turns it off. */}
          <div className={styles.chips}>
            <div
              role="group"
              aria-label="Weather layers"
              className={styles.chipGroup}
            >
              {layerChips.map((chip) => (
                <button
                  key={chip.value}
                  type="button"
                  className={styles.chip}
                  aria-pressed={overlay === chip.value}
                  onClick={() =>
                    setOverlay(overlay === chip.value ? "off" : chip.value)
                  }
                >
                  <Icon name={chip.icon} size={14} />
                  {chip.label}
                </button>
              ))}
            </div>
            {overlay === "rain" ? (
              <div
                role="group"
                aria-label="Rain data"
                className={styles.chipGroup}
              >
                {sourceChips.map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    className={styles.chip}
                    aria-pressed={rainSource === chip.value}
                    aria-label={chip.ariaLabel}
                    onClick={() => setRainSource(chip.value)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {fill ? (
            <>
              {weatherEl}
              <div ref={legendBox} className={styles.legendBox}>
                <div hidden={!legendOpen}>{legendEl}</div>
                <button
                  type="button"
                  className={styles.chip}
                  ref={legendButton}
                  aria-expanded={legendOpen}
                  aria-controls={legendId}
                  onClick={() => setLegendOpen(!legendOpen)}
                >
                  Legend
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}
      {fill ? null : (
        <>
          {weatherEl}
          {legendEl}
        </>
      )}
    </Panel>
  );
}
