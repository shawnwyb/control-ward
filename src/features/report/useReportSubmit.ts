import { useCallback } from "react";
import { useBusy } from "../../hooks/busy";
import { useNotice } from "../../hooks/notice";
import { errorMessage } from "../../lib/format";
import { submitHazardReport } from "../../lib/submission";
import type { MutationResult, Site } from "../../lib/types";
import type { ReportDraft } from "./types";

const allowedPhotoTypes = ["image/jpeg", "image/png", "image/webp"];
const maxPhotoBytes = 5242880;

export function useReportSubmit(
  site: Site,
  refresh: () => Promise<void>,
  /** Runs once the report is stored, before the feed refreshes. */
  onSaved: (response: MutationResult) => void,
) {
  const { announce } = useNotice();
  const { isBusy, setBusy } = useBusy();
  return useCallback(
    async (draft: ReportDraft) => {
      if (isBusy()) return;
      const { file } = draft;
      if (
        file &&
        (!allowedPhotoTypes.includes(file.type) || file.size > maxPhotoBytes)
      ) {
        announce("Choose a JPEG, PNG or WebP photo smaller than 5 MB.", true);
        return;
      }
      setBusy(true);
      try {
        const response = await submitHazardReport({
          siteId: site.id,
          type: draft.type,
          severity: draft.severity,
          latitude: Number(draft.latitude),
          longitude: Number(draft.longitude),
          file,
        });
        onSaved(response);
        announce(
          response.outcome === "merged"
            ? `Merged with a nearby hazard. ${response.report.confirmations} confirmations recorded.`
            : "Report sent. Your site team can now see it.",
        );
        await refresh().catch(() =>
          announce(
            "Report saved. The site feed could not refresh; it will retry automatically.",
            true,
          ),
        );
      } catch (error) {
        announce(
          `${errorMessage(error)} Your input is preserved; you can retry.`,
          true,
        );
      } finally {
        setBusy(false);
      }
    },
    [site.id, refresh, onSaved, announce, isBusy, setBusy],
  );
}
