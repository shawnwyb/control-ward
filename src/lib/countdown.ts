/*
 * Lightning stop-work countdown. No imports, so plain Node tests can load it.
 * Work resumes 30 minutes after the last strike.
 */
export const ALL_CLEAR_MS = 30 * 60 * 1000;

/**
 * Milliseconds left in the 30-minute window after the last strike.
 * Null when there is no (readable) strike or the window is over; never negative.
 */
export function allClearRemaining(
  lastStrikeAt: string | null,
  now: number,
): number | null {
  if (!lastStrikeAt) return null;
  const struck = new Date(lastStrikeAt).getTime();
  if (Number.isNaN(struck)) return null;
  const left = struck + ALL_CLEAR_MS - now;
  if (left <= 0) return null;
  return Math.min(left, ALL_CLEAR_MS);
}

/** "22:14" (minutes:seconds, rounded down; "00:00" for zero or less). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
