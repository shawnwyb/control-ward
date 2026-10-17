/*
 * NOAA nowCOAST radar: MRMS base reflectivity mosaic for the continental US.
 * US government data, no API key, CORS-enabled, new frame about every 4 minutes.
 */
const WMS =
  "https://nowcoast.noaa.gov/geoserver/observations/weather_radar/wms";
const LAYER = "conus_base_reflectivity_mosaic";

/** About 2.5 hours of history, one frame every ~12 minutes. */
const FRAME_COUNT = 12;
const FRAME_STRIDE = 3;

export const RADAR_OPACITY = 0.72;
export const RADAR_CREDIT = "Radar: NOAA / NWS";

/** Light → heavy, sampled from the service's own legend graphic. */
export const radarLegendGradient =
  "linear-gradient(to right, #47c3c3 0%, #34a4f6 15%, #3434f6 22%, #35d949 30%, #349534 40%, #fafd34 46%, #fe9532 57%, #fe3131 64%, #c23535 76%, #bb41e3 90%)";

/** Tile URL for one frame. `{bbox-epsg-3857}` is filled in by MapLibre. */
export function radarTileUrl(time: string): string {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: LAYER,
    STYLES: "",
    CRS: "EPSG:3857",
    WIDTH: "512",
    HEIGHT: "512",
    FORMAT: "image/png",
    TRANSPARENT: "true",
    TIME: time,
  });
  // BBOX is appended raw: URLSearchParams would escape MapLibre's placeholder.
  return `${WMS}?${params.toString()}&BBOX={bbox-epsg-3857}`;
}

/** Newest frames, oldest first, thinned so a loop stays light on the service. */
export function pickFrames(times: string[]): string[] {
  const picked: string[] = [];
  for (
    let i = times.length - 1;
    i >= 0 && picked.length < FRAME_COUNT;
    i -= FRAME_STRIDE
  )
    picked.push(times[i]);
  return picked.reverse();
}

export async function fetchRadarFrames(
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await fetch(
    `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`,
    { signal },
  );
  if (!response.ok)
    throw new Error(`Radar service returned ${response.status}`);
  const xml = new DOMParser().parseFromString(
    await response.text(),
    "text/xml",
  );
  const layer = Array.from(xml.getElementsByTagName("Layer")).find(
    (candidate) =>
      candidate.getElementsByTagName("Name")[0]?.textContent === LAYER,
  );
  const dimension = layer
    ? Array.from(layer.getElementsByTagName("Dimension")).find(
        (candidate) => candidate.getAttribute("name") === "time",
      )
    : undefined;
  const times = (dimension?.textContent ?? "")
    .split(",")
    .map((time) => time.trim())
    .filter(Boolean);
  if (!times.length) throw new Error("No radar frames available");
  return pickFrames(times);
}

const clock = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/** "1:48 PM, 12 min ago", or "1:48 PM, now" for the newest frame. */
export function describeFrame(time: string, now = Date.now()): string {
  const at = new Date(time);
  if (Number.isNaN(at.getTime())) return "";
  const minutes = Math.max(0, Math.round((now - at.getTime()) / 60000));
  const age = minutes < 8 ? "now" : `${minutes} min ago`;
  return `${clock.format(at)}, ${age}`;
}
