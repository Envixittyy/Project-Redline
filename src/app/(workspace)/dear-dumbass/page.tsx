import type { Metadata } from "next";
import { Suspense } from "react";

import { DearDumbassFeed } from "@/features/dear-dumbass";

export const metadata: Metadata = {
  title: "Dear Dumbass",
  description: "Private stream-of-consciousness feed. Population: 1.",
};

export default async function DearDumbassPage({
  searchParams,
}: {
  searchParams?: Promise<{ compose?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const autoFocusComposer = resolvedParams?.compose === "true";

  return (
    <Suspense fallback={null}>
      <DearDumbassFeed autoFocusComposer={autoFocusComposer} />
    </Suspense>
  );
}

