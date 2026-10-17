import { useEffect, useState } from "react";
import { Field, Select } from "../../components/ui";
import { useBusy } from "../../hooks/busy";
import { useNotice } from "../../hooks/notice";
import { fetchSites } from "../../lib/api";
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
  const [siteId, setSiteId] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    fetchSites()
      .then((result) => {
        if (cancelled) return;
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
      {site ? (
        <SiteWorkspace key={site.id} site={site} userId={userId} />
      ) : null}
    </section>
  );
}
