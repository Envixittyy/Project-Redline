import type { Metadata } from "next";

import { PlannedAreaPage } from "@/features/planned-areas/planned-area-page";
import { copy } from "@/lib/copy";

export const metadata: Metadata = {
  title: copy.plannedAreas.gala.name,
  description: copy.plannedAreas.gala.description,
};

export default function GalaPage() {
  return <PlannedAreaPage {...copy.plannedAreas.gala} />;
}
