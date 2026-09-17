import type { Metadata } from "next";

import { PlannedAreaPage } from "@/features/planned-areas/planned-area-page";
import { copy } from "@/lib/copy";

export const metadata: Metadata = {
  title: copy.plannedAreas.people.name,
  description: copy.plannedAreas.people.description,
};

export default function PeoplePage() {
  return <PlannedAreaPage {...copy.plannedAreas.people} />;
}
