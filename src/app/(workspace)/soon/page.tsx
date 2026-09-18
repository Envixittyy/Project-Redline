import type { Metadata } from "next";

import { PlannedAreaPage } from "@/features/planned-areas/planned-area-page";
import { copy } from "@/lib/copy";

export const metadata: Metadata = {
  title: copy.plannedAreas.soon.name,
  description: copy.plannedAreas.soon.description,
};

export default function SoonPage() {
  return <PlannedAreaPage {...copy.plannedAreas.soon} />;
}
