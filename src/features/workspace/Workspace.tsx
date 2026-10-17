import { useEffect, useState } from "react";
import { Field, Select } from "../../components/ui";
import { useBusy } from "../../hooks/busy";
import { useNotice } from "../../hooks/notice";
import { fetchSites } from "../../lib/api";
import { fetchRoles, type Role } from "../../lib/monitoring";
import { errorMessage } from "../../lib/format";
import { discardPhoto } from "../../lib/submission";
import type { Site } from "../../lib/types";
import { NoSites } from "../auth/NoSites";
import { PageHeader } from "../shell/PageHeader";
import { SiteWorkspace } from "./SiteWorkspace";

/** Signed-in area. Mounted per user, so it always starts from a clean state. */
export function Workspace({ userId }: { userId: string }) {
  const { announce } = useNotice();
  const { busy, isBusy } = useBusy();
  const [sites, setSites] = useState<Site[]>();
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [siteId, setSiteId] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSites(), fetchRoles()])
      .then(([result, memberships]) => {
        if (cancelled) return;
        setRoles(memberships);
        setSites(result);
        setSiteId(result[0]?.id);
      })
      .catch((error) => !cancelled && announce(errorMessage(error), true));
    return () => {
      cancelled = true;
    };
  }, [announce]);

  const site = sites?.find((candidate) => candidate.id === siteId);

  async function changeSite(id: string) {
    if (isBusy()) return;
    await discardPhoto();
    setSiteId(id);
  }

  return (
    <section id="workspace">
      <PageHeader
        title={
          site && roles[site.id] === "supervisor"
            ? "Site control"
            : "Crew reporting"
        }
        actions={
          sites?.length ? (
            <Field
              id="site"
              label={
                site && roles[site.id] === "supervisor" ? "Site" : "Your site"
              }
            >
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
      {site ? (
        <SiteWorkspace
          key={site.id}
          site={site}
          role={roles[site.id] ?? "crew"}
          userId={userId}
        />
      ) : null}
    </section>
  );
}
