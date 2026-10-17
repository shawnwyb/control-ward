// NOAA GOES-East GLM Level 2 LCFA flashes (public domain, via the noaa-goes19 S3 bucket).
// Each ~260 KB file covers 20 seconds. These are optical flash detections, not a ground-strike network.
import type { Strike } from "./types.ts";

export const GLM_BUCKET = "https://noaa-goes19.s3.amazonaws.com";
const FILE_SECONDS = 20;
// Packing from the GLM L2 product spec: offsets are int16 seconds with scale 3.8147554e-4 and offset 9.5.
const TIME_SCALE = 3.8147554e-4;
const TIME_OFFSET = 9.5;
const J2000_NOON_UTC = Date.UTC(2000, 0, 1, 12);

export interface HdfFile {
  get(name: string): { value: ArrayLike<number> };
}
export interface Box {
  south: number;
  north: number;
  west: number;
  east: number;
}

function dayOfYear(ms: number): number {
  const d = new Date(ms);
  return Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000);
}

// Hour folders that can hold files from the last windowMs.
export function listingPrefixes(nowMs: number, windowMs: number): string[] {
  const out = new Set<string>();
  for (const t of [nowMs, nowMs - windowMs]) {
    const d = new Date(t);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    out.add(
      `GLM-L2-LCFA/${d.getUTCFullYear()}/${String(dayOfYear(t)).padStart(3, "0")}/${hh}/`,
    );
  }
  return [...out];
}

export function parseListing(xml: string): { key: string; modified: number }[] {
  const out: { key: string; modified: number }[] = [];
  for (const m of xml.matchAll(
    /<Key>([^<]+\.nc)<\/Key><LastModified>([^<]+)<\/LastModified>/g,
  )) {
    out.push({ key: m[1], modified: Date.parse(m[2]) });
  }
  return out;
}

// Files published within the window. Overlap between runs is safe: ingest_strikes ignores duplicates.
export function recentKeys(
  listing: { key: string; modified: number }[],
  nowMs: number,
  windowMs: number,
): string[] {
  return listing
    .filter(
      (f) => f.modified > nowMs - windowMs && f.modified <= nowMs + 60_000,
    )
    .sort((a, b) => a.modified - b.modified)
    .map((f) => f.key);
}

export function extractStrikes(
  file: HdfFile,
  box: Box,
  source = "goes-glm",
): Strike[] {
  const lat = file.get("flash_lat").value,
    lon = file.get("flash_lon").value;
  const offset = file.get("flash_time_offset_of_first_event").value;
  const quality = file.get("flash_quality_flag").value;
  const start = J2000_NOON_UTC + file.get("product_time").value[0] * 1000;
  const out: Strike[] = [];
  for (let i = 0; i < lat.length; i++) {
    if (quality[i] !== 0) continue; // 0 = good quality
    if (
      lat[i] < box.south ||
      lat[i] > box.north ||
      lon[i] < box.west ||
      lon[i] > box.east
    )
      continue;
    const seconds = Math.min(
      Math.max(offset[i] * TIME_SCALE + TIME_OFFSET, 0),
      FILE_SECONDS,
    );
    out.push({
      lat: Math.round(lat[i] * 1e4) / 1e4,
      lon: Math.round(lon[i] * 1e4) / 1e4,
      struck_at: new Date(Math.round(start + seconds * 1000)).toISOString(),
      source,
    });
  }
  return out;
}
