import type { HazardType, Severity } from "../../lib/types";

/** Form values. Coordinates stay strings so the inputs remain editable. */
export type ReportDraft = {
  type: HazardType;
  severity: Severity;
  latitude: string;
  longitude: string;
  file?: File;
};
