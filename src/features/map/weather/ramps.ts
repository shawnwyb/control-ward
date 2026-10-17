/** Colour ramps for the weather overlays. Values interpolate linearly between stops. */
export type Rgba = [number, number, number, number];
export type Stop = [value: number, color: Rgba];

/** Air temperature, °F: violet → blue → teal → green → yellow → orange → red. */
export const temperatureRamp: Stop[] = [
  [-10, [126, 87, 194, 215]],
  [10, [92, 107, 192, 215]],
  [25, [63, 142, 252, 215]],
  [40, [41, 182, 214, 215]],
  [52, [76, 195, 138, 215]],
  [62, [166, 216, 84, 215]],
  [72, [255, 210, 63, 215]],
  [82, [255, 159, 67, 215]],
  [92, [239, 83, 80, 215]],
  [102, [194, 24, 91, 215]],
];
export const TEMPERATURE_RANGE: [number, number] = [20, 100];

/** Rain, inches per hour. Clear below ~0.005 so dry areas stay see-through. */
export const precipitationRamp: Stop[] = [
  [0.004, [160, 205, 255, 0]],
  [0.02, [150, 200, 255, 140]],
  [0.08, [90, 150, 245, 180]],
  [0.2, [60, 100, 225, 200]],
  [0.5, [95, 60, 200, 218]],
  [1.0, [170, 60, 200, 232]],
];
export const PRECIPITATION_RANGE: [number, number] = [0.02, 1.0];

/** Wind speed, m/s, for particle colour: calm teal → blue → violet → magenta. */
export const windRamp: Stop[] = [
  [0, [92, 180, 210, 190]],
  [4, [58, 140, 225, 215]],
  [8, [44, 100, 215, 230]],
  [13, [112, 72, 208, 240]],
  [19, [190, 60, 190, 245]],
  [26, [225, 50, 100, 250]],
];
export const WIND_RANGE_MPH: [number, number] = [0, 58];
export const MS_TO_MPH = 2.23694;

export function colorAt(stops: Stop[], value: number): Rgba {
  if (value <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    if (value <= v1) {
      const [v0, c0] = stops[i - 1];
      const f = (value - v0) / (v1 - v0);
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
        c0[3] + (c1[3] - c0[3]) * f,
      ];
    }
  }
  return stops[stops.length - 1][1];
}

/** CSS gradient for a legend bar, opaque, sampled across [min, max]. */
export function legendGradient(
  stops: Stop[],
  min: number,
  max: number,
): string {
  const parts: string[] = [];
  for (let i = 0; i <= 8; i++) {
    const f = i / 8;
    const [r, g, b] = colorAt(stops, min + (max - min) * f);
    parts.push(
      `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)}) ${Math.round(f * 100)}%`,
    );
  }
  return `linear-gradient(to right, ${parts.join(", ")})`;
}
