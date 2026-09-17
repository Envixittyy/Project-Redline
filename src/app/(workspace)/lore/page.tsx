import type { Metadata } from "next";

import { PlannedAreaPage } from "@/features/planned-areas/planned-area-page";
import { copy } from "@/lib/copy";

export const metadata: Metadata = {
  title: copy.plannedAreas.lore.name,
  description: copy.plannedAreas.lore.description,
};

export default function LorePage() {
  return <PlannedAreaPage {...copy.plannedAreas.lore} />;
}
