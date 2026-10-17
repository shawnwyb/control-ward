import type { ForecastGrid } from "./forecast";
import { colorAt, precipitationRamp, temperatureRamp } from "./ramps";
import type { FieldVariable } from "./types";

export type Bounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export function gridBounds(grid: ForecastGrid): Bounds {
  return {
    west: grid.lons[0],
    east: grid.lons[grid.lons.length - 1],
    south: grid.lats[0],
    north: grid.lats[grid.lats.length - 1],
  };
}

/** Bilinear sample of one hour of a field at lng/lat. NaN outside the grid. */
export function sampleField(
  grid: ForecastGrid,
  data: Float32Array,
  hour: number,
  lng: number,
  lat: number,
): number {
  const nI = grid.lons.length;
  const nJ = grid.lats.length;
  const fi =
    ((lng - grid.lons[0]) / (grid.lons[nI - 1] - grid.lons[0])) * (nI - 1);
  const fj =
    ((lat - grid.lats[0]) / (grid.lats[nJ - 1] - grid.lats[0])) * (nJ - 1);
  if (!(fi >= 0 && fi <= nI - 1 && fj >= 0 && fj <= nJ - 1)) return NaN;
  const i0 = Math.min(Math.floor(fi), nI - 2);
  const j0 = Math.min(Math.floor(fj), nJ - 2);
  const x = fi - i0;
  const y = fj - j0;
  const base = hour * nJ * nI;
  const at = (j: number, i: number) => data[base + j * nI + i];
  return (
    at(j0, i0) * (1 - x) * (1 - y) +
    at(j0, i0 + 1) * x * (1 - y) +
    at(j0 + 1, i0) * (1 - x) * y +
    at(j0 + 1, i0 + 1) * x * y
  );
}

const mercatorY = (latDegrees: number) =>
  Math.log(Math.tan(Math.PI / 4 + (latDegrees * Math.PI) / 360));
const latFromMercator = (y: number) =>
  ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
const smoothstep = (edge: number) => {
  const t = Math.min(1, Math.max(0, edge));
  return t * t * (3 - 2 * t);
};

const WIDTH = 320;
/** Fade to clear over this share of the width at every edge, so the patch has no hard border. */
const FEATHER = 0.2;

export type FieldFrames = {
  /** NW, NE, SE, SW corners as [lng, lat], the order MapLibre image sources expect. */
  coordinates: [number, number][];
  /** One PNG data URL per forecast hour. */
  images: string[];
};

/**
 * Paints each forecast hour of a variable as a smooth, feathered colour image.
 * Pixels are spaced evenly in Web Mercator, so the image lands on the map without distortion.
 */
export function renderFieldFrames(
  grid: ForecastGrid,
  variable: FieldVariable,
): FieldFrames {
  const { west, east, south, north } = gridBounds(grid);
  const yNorth = mercatorY(north);
  const ySouth = mercatorY(south);
  const lngSpan = ((east - west) * Math.PI) / 180;
  const height = Math.round((WIDTH * (yNorth - ySouth)) / lngSpan);
  const data =
    variable === "temperature" ? grid.temperature : grid.precipitation;
  const ramp = variable === "temperature" ? temperatureRamp : precipitationRamp;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(WIDTH, height);

  const images = grid.times.map((_, hour) => {
    for (let py = 0; py < height; py++) {
      const lat = latFromMercator(
        yNorth - ((py + 0.5) / height) * (yNorth - ySouth),
      );
      const edgeY = Math.min(py, height - 1 - py) / (height * FEATHER);
      for (let px = 0; px < WIDTH; px++) {
        const lng = west + ((px + 0.5) / WIDTH) * (east - west);
        const value = sampleField(grid, data, hour, lng, lat);
        const at = (py * WIDTH + px) * 4;
        if (Number.isNaN(value)) {
          image.data[at + 3] = 0;
          continue;
        }
        const [r, g, b, a] = colorAt(ramp, value);
        const edgeX = Math.min(px, WIDTH - 1 - px) / (WIDTH * FEATHER);
        image.data[at] = r;
        image.data[at + 1] = g;
        image.data[at + 2] = b;
        image.data[at + 3] = a * smoothstep(Math.min(edgeX, edgeY));
      }
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  });

  return {
    coordinates: [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ],
    images,
  };
}
