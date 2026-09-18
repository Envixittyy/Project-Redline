import type { Metadata } from "next";

import { PlannedAreaPage } from "@/features/planned-areas/planned-area-page";
import { copy } from "@/lib/copy";

export const metadata: Metadata = {
  title: copy.plannedAreas.journal.name,
  description: copy.plannedAreas.journal.description,
};

export default function DearDumbassPage() {
  return <PlannedAreaPage {...copy.plannedAreas.journal} />;
}
