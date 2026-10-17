// Time zone math with Intl only, so it behaves the same in Deno and Node.
interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  s: number;
}

function parts(utcMs: number, tz: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(utcMs)))
    if (p.type !== "literal") out[p.type] = Number(p.value);
  return {
    y: out.year,
    m: out.month,
    d: out.day,
    h: out.hour,
    min: out.minute,
    s: out.second,
  };
}

export function localParts(utcMs: number, tz: string): Parts {
  return parts(utcMs, tz);
}

export function localDate(utcMs: number, tz: string): string {
  const p = parts(utcMs, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Wall-clock time in a zone to a UTC instant (ms). Two passes settle DST offsets.
export function zonedToUtc(date: string, hour: number, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hour, 0, 0);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = parts(guess, tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    guess = wall - (asUtc - Math.floor(guess / 1000) * 1000);
  }
  return guess;
}

// The most recent 18:00 -> 06:00 local window that has started, clipped to now.
export function overnightWindow(
  nowMs: number,
  tz: string,
): { start: number; end: number } {
  const today = localDate(nowMs, tz);
  const hour = parts(nowMs, tz).h;
  if (hour >= 18) return { start: zonedToUtc(today, 18, tz), end: nowMs };
  return {
    start: zonedToUtc(addDays(today, -1), 18, tz),
    end: Math.min(nowMs, zonedToUtc(today, 6, tz)),
  };
}
