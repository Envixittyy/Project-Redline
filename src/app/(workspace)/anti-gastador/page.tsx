import type { Metadata } from "next";

import { PlannedAreaPage } from "@/features/planned-areas/planned-area-page";
import { copy } from "@/lib/copy";

export const metadata: Metadata = {
  title: copy.plannedAreas.antiGastador.name,
  description: copy.plannedAreas.antiGastador.description,
};

export default function AntiGastadorPage() {
  return <PlannedAreaPage {...copy.plannedAreas.antiGastador} />;
}
