import { useEffect, useState } from "react";
import { fetchReport, type ReportResult } from "../../lib/nextDayReport";

/** Loads a site's newest report. `null` while loading. */
export function useReport(eia: string | null | undefined): ReportResult | null {
  const [result, setResult] = useState<ReportResult | null>(null);
  useEffect(() => {
    setResult(null);
    if (!eia) return;
    const ctl = new AbortController();
    fetchReport(eia, ctl.signal)
      .then((r) => !ctl.signal.aborted && setResult(r))
      .catch(() => undefined);
    return () => ctl.abort();
  }, [eia]);
  return result;
}
