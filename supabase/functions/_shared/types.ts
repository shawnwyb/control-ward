export type Hazard =
  "weather" | "lightning" | "flood" | "heat" | "wildfire" | "soil" | "wildlife";

export interface Site {
  id: string;
  latitude: number;
  longitude: number;
  timezone: string;
  usgs_gauge_id: string | null;
}

// One row for the ingest_readings RPC. Omitted forecast_for means a live observation.
export interface Reading {
  site_id: string;
  hazard: Hazard;
  value: number;
  unit: string;
  observed_at: string;
  forecast_for?: string;
  source: string;
}

export interface Strike {
  lat: number;
  lon: number;
  struck_at: string;
  source: string;
}
