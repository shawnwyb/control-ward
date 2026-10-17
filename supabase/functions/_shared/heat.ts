// Heat stress. WBGT here is an engineering approximation (Stull wet bulb plus a solar and wind
// adjustment for natural wet bulb and globe temperature). It is NOT the Liljegren model used by
// thermofeel or NWS grids, and it must be validated before it drives real go/no-go decisions.
const toC = (f: number) => ((f - 32) * 5) / 9;
const toF = (c: number) => (c * 9) / 5 + 32;

// Stull (2011), valid for 5-99% RH and -20..50 C.
export function wetBulbC(tC: number, rh: number): number {
  return (
    tC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(tC + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
    4.686035
  );
}

export function wbgtF(
  tempF: number,
  rh: number,
  windMph: number,
  solarWm2: number,
): number {
  const ta = toC(tempF);
  const windMs = Math.max(windMph, 0) * 0.44704;
  const sun = Math.max(solarWm2, 0);
  const tnwb = wetBulbC(ta, Math.min(Math.max(rh, 5), 99)) + 0.0015 * sun;
  const tg = ta + (0.015 * sun) / (1 + 0.25 * windMs);
  return toF(0.7 * tnwb + 0.2 * tg + 0.1 * ta);
}

// NWS Rothfusz regression with the standard low-humidity and high-humidity adjustments (deg F).
export function heatIndexF(t: number, rh: number): number {
  const simple = 0.5 * (t + 61 + (t - 68) * 1.2 + rh * 0.094);
  if ((simple + t) / 2 < 80) return (simple + t) / 2;
  let hi =
    -42.379 +
    2.04901523 * t +
    10.14333127 * rh -
    0.22475541 * t * rh -
    0.00683783 * t * t -
    0.05481717 * rh * rh +
    0.00122874 * t * t * rh +
    0.00085282 * t * rh * rh -
    0.00000199 * t * t * rh * rh;
  if (rh < 13 && t >= 80 && t <= 112)
    hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
  else if (rh > 85 && t >= 80 && t <= 87)
    hi += ((rh - 85) / 10) * ((87 - t) / 5);
  return hi;
}
