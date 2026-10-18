import type { IconName } from "../../components/ui";
import type { Subscores } from "../../lib/monitoring";

type Hazard = keyof Subscores;

/** Short name and icon for each hazard that feeds a site's index. */
export const hazardInfo: Record<
  Hazard,
  { name: string; icon: IconName; tag: string }
> = {
  heat: { name: "Heat", icon: "heat", tag: "orange" },
  weather: { name: "Severe weather", icon: "wind", tag: "blue" },
  lightning: { name: "Lightning", icon: "bolt", tag: "yellow" },
  flood: { name: "Flood", icon: "flood", tag: "blue" },
  wildfire: { name: "Wildfire", icon: "fire", tag: "red" },
  soil: { name: "Soil", icon: "soil", tag: "brown" },
  wildlife: { name: "Wildlife", icon: "wildlife", tag: "purple" },
};
