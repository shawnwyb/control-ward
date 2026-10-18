import { useEffect, useState } from "react";
import { useBusy } from "../../hooks/busy";
import { useNotice } from "../../hooks/notice";
import { useSiteFeed } from "../../hooks/useSiteFeed";
import { fetchSites } from "../../lib/api";
import { errorMessage } from "../../lib/format";
import { fetchRoles, type Role } from "../../lib/monitoring";
import { allowedPage, homeFor, useRoute } from "../../lib/route";
import { discardPhoto } from "../../lib/submission";
import type { Site } from "../../lib/types";
import { NoSites } from "../auth/NoSites";
import { AppShell } from "../shell/AppShell";
import { Sidebar } from "../shell/Sidebar";
import { SiteWorkspace } from "./SiteWorkspace";

const siteKey = "planit.site";

function savedSite(): string | null {
  try {
    return localStorage.getItem(siteKey);
  } catch {
    return null;
  }
}

function saveSite(id: string) {
  try {
    localStorage.setItem(siteKey, id);
  } catch {
    // Private windows can refuse storage; the choice just won't persist.
  }
}

/** Signed-in area. Mounted per user, so it always starts from a clean state. */
export function Workspace({
  userId,
  email,
  onSignOut,
}: {
  userId: string;
  email?: string;
  onSignOut: () => void;
}) {
  const { announce } = useNotice();
  const { busy, isBusy } = useBusy();
  const [route, setRoute] = useRoute();
  const [sites, setSites] = useState<Site[]>();
  const [roles, setRoles] = useState<Record<string, Role>>({});
  // The one selected site: the sidebar switcher and every page follow it.
  const [siteId, setSiteId] = useState<string>();
  const [alertCount, setAlertCount] = useState(0);
  const feed = useSiteFeed(siteId, (message) => announce(message, true));

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSites(), fetchRoles()])
      .then(([result, memberships]) => {
        if (cancelled) return;
        const remembered = savedSite();
        setRoles(memberships);
        setSites(result);
        setSiteId(
          result.find((candidate) => candidate.id === remembered)?.id ??
            result[0]?.id,
        );
      })
      .catch((error) => !cancelled && announce(errorMessage(error), true));
    return () => {
      cancelled = true;
    };
  }, [announce]);

  const site = sites?.find((candidate) => candidate.id === siteId);
  const role: Role | undefined = site ? (roles[site.id] ?? "crew") : undefined;

  // Landing and sign-in are for signed-out visitors; pages the role may not open go home.
  const page = !role
    ? route
    : route === "landing" || route === "sign-in"
      ? homeFor(role)
      : allowedPage(route, role);
  useEffect(() => {
    if (page !== route) setRoute(page, true);
  }, [page, route, setRoute]);

  async function changeSite(id: string) {
    if (isBusy()) return;
    await discardPhoto();
    saveSite(id);
    setSiteId(id);
  }

  return (
    <AppShell
      sidebar={
        <Sidebar
          role={role}
          sites={sites ?? []}
          siteId={siteId}
          onSiteChange={(id) => void changeSite(id)}
          page={page}
          onNavigate={setRoute}
          alertCount={alertCount}
          email={email}
          onSignOut={onSignOut}
          busy={busy}
          connection={feed.connection}
        />
      }
    >
      {sites && sites.length === 0 ? <NoSites /> : null}
      {site && role ? (
        <SiteWorkspace
          key={site.id}
          site={site}
          role={role}
          userId={userId}
          page={page}
          onNavigate={setRoute}
          feed={feed}
          onAlertCount={setAlertCount}
        />
      ) : null}
    </AppShell>
  );
}
