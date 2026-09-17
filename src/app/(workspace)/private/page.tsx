import type { Metadata } from "next";

import { PlannedAreaPage } from "@/features/planned-areas/planned-area-page";
import { copy } from "@/lib/copy";

export const metadata: Metadata = {
  title: copy.plannedAreas.privateData.name,
  description: copy.plannedAreas.privateData.description,
};

export default function PrivatePage() {
  return <PlannedAreaPage {...copy.plannedAreas.privateData} />;
}
