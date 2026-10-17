import { lazy, Suspense, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Panel,
  PanelHeader,
  Segmented,
  SeverityMark,
  TimeSlider,
} from "../../components/ui";
import { SITE_RADIUS_M } from "../../lib/geo";
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

type Props = {
  site: Site;
  reports: Report[];
  pin: { latitude: number; longitude: number };
  disabled: boolean;
  className?: string;
  highlightId?: string | null;
  focusRequest?: { id: string; nonce: number };
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
  pin,
  disabled,
  className,
  highlightId,
  focusRequest,
  onPin,
}: Props) {
  const [unavailable, setUnavailable] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>("off");
  const [rainSource, setRainSource] = useState<RainSource>("radar");

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

  return (
    <Panel className={className} aria-labelledby="map-title">
      <PanelHeader
        title={site.name}
        titleId="map-title"
        aside={<Badge>1200 m × 800 m</Badge>}
      />
      <div className={styles.overlayRow}>
        <span className={styles.overlayLabel}>Weather</span>
        <Segmented<Overlay>
          label="Weather overlay"
          name="weather-overlay"
          value={overlay}
          options={[
            { value: "off", label: "Off" },
            { value: "rain", label: "Rain" },
            { value: "wind", label: "Wind" },
            { value: "temperature", label: "Temp", ariaLabel: "Temperature" },
          ]}
          onChange={setOverlay}
        />
        {overlay === "rain" ? (
          <Segmented<RainSource>
            label="Rain data"
            name="rain-source"
            value={rainSource}
            options={[
              {
                value: "radar",
                label: "Radar",
                ariaLabel: "Radar, past 2 hours",
              },
              {
                value: "forecast",
                label: "Forecast",
                ariaLabel: "Forecast, next 12 hours",
              },
            ]}
            onChange={setRainSource}
          />
        ) : null}
      </div>
      {unavailable ? (
        <div className={styles.placeholder}>
          The map isn’t available on this device. Use “Use my location” or enter
          coordinates.
        </div>
      ) : (
        <Suspense
          fallback={<div className={styles.placeholder}>Loading map…</div>}
        >
          <MapCanvas
            key={site.id}
            site={site}
            reports={reports}
            pin={pin}
            disabled={disabled}
            highlightId={highlightId}
            focusRequest={focusRequest}
            weather={weather}
            regional={overlay !== "off"}
            onPin={onPin}
            onUnavailable={() => setUnavailable(true)}
          />
        </Suspense>
      )}
      {source ? (
        <div className={styles.weather}>
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
      <ul className={styles.legend}>
        <li>
          <span className={styles.pinSample} aria-hidden="true" />
          Your pin
        </li>
        {([1, 2, 3] as Severity[]).map((severity) => (
          <li key={severity}>
            <SeverityMark severity={severity} size={14} />
            {["", "Low", "Moderate", "High"][severity]}
          </li>
        ))}
        <li className={styles.note}>
          Dashed ring: {SITE_RADIUS_M} m from site center
        </li>
        <li className={`${styles.note} ${styles.keyboardHint}`}>
          With the map focused, arrow keys move the pin (Shift for 100 m).
        </li>
      </ul>
    </Panel>
  );
}
