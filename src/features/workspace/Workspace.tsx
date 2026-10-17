import { useEffect, useState } from "react";
import { Field, Select, TabPanel, Tabs } from "../../components/ui";
import { useBusy } from "../../hooks/busy";
import { useNotice } from "../../hooks/notice";
import { fetchSites } from "../../lib/api";
import { fetchMyRoles, type SiteRole } from "../../lib/crew";
import { errorMessage } from "../../lib/format";
import { discardPhoto } from "../../lib/submission";
import type { Site } from "../../lib/types";
import { NoSites } from "../auth/NoSites";
import { CrewManager } from "../crew/CrewManager";
import { PageHeader } from "../shell/PageHeader";
import { SiteWorkspace } from "./SiteWorkspace";

type View = "operations" | "crew";

/**
 * Signed-in area. Mounted per user, so it always starts from a clean state.
 * Crew get the reporting screen. Supervisors get the same screen plus a Crew
 * tab for managing who is on the site. Tabs switch views on this one page.
 */
export function Workspace({ userId }: { userId: string }) {
  const { announce } = useNotice();
  const { busy, isBusy } = useBusy();
  const [sites, setSites] = useState<Site[]>();
  const [roles, setRoles] = useState<Map<string, SiteRole>>(new Map());
  const [siteId, setSiteId] = useState<string>();
  const [view, setView] = useState<View>("operations");
  // The Crew tab loads its roster only once it has been opened, then stays mounted.
  const [crewOpened, setCrewOpened] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadRoles = fetchMyRoles(userId).catch((error) => {
      // Least privilege on failure: show the crew screen. The database still enforces roles.
      if (!cancelled)
        announce(
          `${errorMessage(error)} Your role could not be loaded, so you are seeing the crew view.`,
          true,
        );
      return new Map<string, SiteRole>();
    });
    Promise.all([fetchSites(), loadRoles])
      .then(([result, myRoles]) => {
        if (cancelled) return;
        setSites(result);
        setRoles(myRoles);
        setSiteId(result[0]?.id);
      })
      .catch((error) => !cancelled && announce(errorMessage(error), true));
    return () => {
      cancelled = true;
    };
  }, [announce, userId]);

  const site = sites?.find((candidate) => candidate.id === siteId);
  const role: SiteRole = (site && roles.get(site.id)) || "crew";
  const isSupervisor = role === "supervisor";

  async function changeSite(id: string) {
    if (isBusy()) return;
    await discardPhoto();
    setSiteId(id);
    setView("operations");
    setCrewOpened(false);
  }

  function changeView(next: View) {
    setView(next);
    if (next === "crew") setCrewOpened(true);
  }

  return (
    <section id="workspace">
      <PageHeader
        actions={
          sites?.length ? (
            <Field id="site" label="Your site">
              <Select
                id="site"
                value={siteId ?? ""}
                disabled={busy}
                onChange={(event) => void changeSite(event.target.value)}
              >
                {sites.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : undefined
        }
      />
      {sites && sites.length === 0 ? <NoSites /> : null}
      {site && isSupervisor ? (
        <>
          <Tabs<View>
            label="Supervisor views"
            idBase="workspace"
            value={view}
            onChange={changeView}
            tabs={[
              { value: "operations", label: "Operations" },
              { value: "crew", label: "Crew" },
            ]}
          />
          {/* Hidden, not removed: a half-written report and the map survive a tab switch. */}
          <TabPanel
            idBase="workspace"
            value="operations"
            active={view === "operations"}
          >
            <SiteWorkspace
              key={site.id}
              site={site}
              userId={userId}
              role={role}
            />
          </TabPanel>
          <TabPanel idBase="workspace" value="crew" active={view === "crew"}>
            {crewOpened ? (
              <CrewManager key={site.id} site={site} userId={userId} />
            ) : null}
          </TabPanel>
        </>
      ) : site ? (
        <SiteWorkspace key={site.id} site={site} userId={userId} role={role} />
      ) : null}
    </section>
  );
}
