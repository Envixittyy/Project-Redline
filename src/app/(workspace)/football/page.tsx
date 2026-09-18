import type { Metadata } from "next";

import { PlannedAreaPage } from "@/features/planned-areas/planned-area-page";
import { copy } from "@/lib/copy";

export const metadata: Metadata = {
  title: copy.plannedAreas.football.name,
  description: copy.plannedAreas.football.description,
};

export default function FootballPage() {
  return <PlannedAreaPage {...copy.plannedAreas.football} />;
}
