/*
 * Pure helpers for useLive, kept free of imports so plain Node tests can load them.
 * The hook outlives a site switch (the map must not remount), so it has to make sure
 * one site's data never shows under another site's name.
 */

/** What useLive holds: the data and which site it belongs to. */
export type LiveState<T> = {
  siteId: string;
  data: T;
  loaded: boolean;
  failed: boolean;
};

/**
 * The state as it may be shown for `siteId`. Data held for another site is never
 * shown: until the new site's first answer arrives it reads as not loaded, with
 * `initial` data. Derived during render, so no frame paints the old site's data.
 */
export function liveView<T>(
  state: LiveState<T>,
  siteId: string,
  initial: T,
): LiveState<T> {
  return state.siteId === siteId
    ? state
    : { siteId, data: initial, loaded: false, failed: false };
}

/**
 * Lets only the latest request for the selected site land. `start(site)` returns a
 * check that is true while that request is still the newest and its site is still
 * selected; a late answer for a site the user has left, or a superseded poll, is dropped.
 */
export function requestGate(siteId: string) {
  let current = siteId;
  let version = 0;
  return {
    select(next: string) {
      if (next === current) return;
      current = next;
      version++;
    },
    start(site: string): () => boolean {
      const mine = ++version;
      return () => current === site && version === mine;
    },
  };
}
