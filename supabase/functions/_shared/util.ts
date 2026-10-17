export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

// Start of the n-minute bucket containing ms, as ISO. Reruns in one bucket overwrite instead of piling up rows.
export function bucketIso(ms: number, minutes: number): string {
  const size = minutes * 60_000;
  return new Date(Math.floor(ms / size) * size).toISOString();
}

// Map with bounded concurrency; a failed item yields null so one bad site cannot sink the run.
export async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try {
          results[i] = await fn(items[i]);
        } catch {
          results[i] = null;
        }
      }
    }),
  );
  return results;
}
