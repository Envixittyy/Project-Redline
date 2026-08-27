import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { WidgetPreview } from "@/features/home/widget-preview";

export const metadata: Metadata = {
  title: "Home",
};

export default function HomePage() {
  return (
    <>
      <PageHeader
        eyebrow="Your space"
        title="A calmer place for everything."
        description="The shell is ready for the routines, commitments, and projects that shape your days. For now, this is a quiet preview of what Home will become."
      />
      <WidgetPreview />
    </>
  );
}
