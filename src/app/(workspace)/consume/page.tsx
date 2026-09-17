import type { Metadata } from "next";

import { PlannedAreaPage } from "@/features/planned-areas/planned-area-page";
import { copy } from "@/lib/copy";

export const metadata: Metadata = {
  title: copy.plannedAreas.media.name,
  description: copy.plannedAreas.media.description,
};

export default function ConsumePage() {
  return <PlannedAreaPage {...copy.plannedAreas.media} />;
}
