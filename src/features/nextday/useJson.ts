import { useEffect, useState } from "react";
import { reportFileUrl } from "../../lib/nextDayReport";

/** A file next to the report (route lines, tide shading, levees). `failed` is true when it could not be loaded. */
export function useJson<T>(
  eia: string,
  rel: string | null | undefined,
): { data: T | null; failed: boolean } {
  const [state, setState] = useState<{ data: T | null; failed: boolean }>({
    data: null,
    failed: false,
  });
  useEffect(() => {
    setState({ data: null, failed: false });
    if (!rel) return;
    const ctl = new AbortController();
    fetch(reportFileUrl(eia, rel), { signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(r.status)))
      .then((data) => !ctl.signal.aborted && setState({ data, failed: false }))
      .catch(
        () => !ctl.signal.aborted && setState({ data: null, failed: true }),
      );
    return () => ctl.abort();
  }, [eia, rel]);
  return state;
}
