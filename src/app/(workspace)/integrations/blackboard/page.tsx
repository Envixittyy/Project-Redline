import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";

export const metadata: Metadata = { title: "Blackboard integration" };
export default function BlackboardPage() {
  return (
    <>
      <PageHeader
        title="Blackboard"
        description="Authenticated notification-email ingestion for School assignments, quizzes, exams, materials, and announcements."
      />
      <Surface
        variant="glass"
        style={{ padding: "1rem", display: "grid", gap: "0.75rem" }}
      >
        <h2 style={{ margin: 0 }}>School email ingestion is the active S1 path</h2>
        <p style={{ margin: 0, color: "var(--text-secondary)" }}>
          Blackboard Calendar sync has been removed. Configure Outlook forwarding,
          Postmark, and the server-only School email environment variables described in
          the deployment guide, then review received work and course mappings in School.
        </p>
        <Link
          href="/school"
          style={{
            alignItems: "center",
            color: "var(--accent-text)",
            display: "inline-flex",
            fontWeight: 700,
            minHeight: "2.75rem",
            width: "fit-content",
          }}
        >
          Open School
        </Link>
      </Surface>
    </>
  );
}
