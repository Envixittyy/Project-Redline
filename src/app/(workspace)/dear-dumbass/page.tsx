import type { Metadata } from "next";

import { DearDumbassFeed } from "@/features/dear-dumbass";

export const metadata: Metadata = {
  title: "Dear Dumbass",
  description: "Private stream-of-consciousness feed. Population: 1.",
};

export default function DearDumbassPage() {
  return <DearDumbassFeed />;
}
