import type { ForecastGrid } from "./forecast";

export type FieldVariable = "temperature" | "precipitation";

/** What the map should currently show as weather. `null` means nothing. */
export type WeatherView =
  | { kind: "radar"; frames: string[]; index: number }
  | {
      kind: "field";
      variable: FieldVariable;
      /** One pre-rendered colour-field image per forecast hour. */
      images: string[];
      /** Image corners: NW, NE, SE, SW as [lng, lat]. */
      coordinates: [number, number][];
      index: number;
    }
  | { kind: "wind"; grid: ForecastGrid; index: number };
