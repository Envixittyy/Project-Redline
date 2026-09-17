import type { Metadata } from "next";

import { PlannedAreaPage } from "@/features/planned-areas/planned-area-page";
import { copy } from "@/lib/copy";

export const metadata: Metadata = {
  title: copy.plannedAreas.skills.name,
  description: copy.plannedAreas.skills.description,
};

export default function SkillsPage() {
  return <PlannedAreaPage {...copy.plannedAreas.skills} />;
}
