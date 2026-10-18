import { useCallback, useSyncExternalStore } from "react";
import type { Role } from "./monitoring";

export type Page =
  | "landing"
  | "sign-in"
  | "sites"
  | "site"
  | "alerts"
  | "briefing"
  | "crew"
  | "reports"
  | "next-day-report";

const pages: readonly Page[] = [
  "landing",
  "sign-in",
  "sites",
  "site",
  "alerts",
  "briefing",
  "crew",
  "reports",
  "next-day-report",
];

const supervisorOnly: readonly Page[] = ["sites", "crew"];
const crewOnly: readonly Page[] = ["site"];

/** `#/alerts` becomes "alerts". An empty or unknown hash is the landing page. */
export function parseRoute(hash: string): Page {
  const name = hash.replace(/^#\/?/, "");
  return pages.find((page) => page === name) ?? "landing";
}

export function homeFor(role: Role): Page {
  return role === "supervisor" ? "sites" : "site";
}

/** Pages a role may not open go to that role's home. */
export function allowedPage(page: Page, role: Role): Page {
  if (role === "crew" && supervisorOnly.includes(page)) return homeFor(role);
  if (role === "supervisor" && crewOnly.includes(page)) return homeFor(role);
  return page;
}

// replaceState does not fire hashchange, so replacements announce themselves.
const replaced = "planit:route";

function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  window.addEventListener(replaced, listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener(replaced, listener);
  };
}

/**
 * The current page from the URL hash. The setter adds a history entry so back and
 * forward work; pass `replace` for redirects that should not be a back-button stop.
 * Only the hash changes, so the query string is left alone.
 */
export function useRoute(): [Page, (page: Page, replace?: boolean) => void] {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => "",
  );
  const setPage = useCallback((page: Page, replace = false) => {
    const target = `#/${page}`;
    if (window.location.hash === target) return;
    if (replace) {
      window.history.replaceState(null, "", target);
      window.dispatchEvent(new Event(replaced));
    } else {
      window.location.hash = target;
    }
  }, []);
  return [parseRoute(hash), setPage];
}
