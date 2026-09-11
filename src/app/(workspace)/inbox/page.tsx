import type { Metadata } from "next";

import { Callout } from "@/components/ui/callout";
import { PageHeader } from "@/components/ui/page-header";
import { CaptureComposer } from "@/features/capture/capture-composer";
import { CaptureInbox, type CaptureInboxViewItem } from "@/features/capture/capture-inbox";
import { listCaptureInbox } from "@/services/captures/capture-repository";
import { isSupabaseConfigured } from "@/services/supabase/public-config";

import styles from "./inbox-page.module.css";

export const metadata: Metadata = { title: "Capture Inbox" };

export default async function InboxPage() {
  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title="Capture Inbox" description="Raw input stays intact until you review and confirm what it should become." />
        <Callout variant="warning" title="Connect Supabase to use universal capture">
          Apply the P2 capture migration after configuring the project environment.
        </Callout>
      </>
    );
  }

  const items = await listCaptureInbox();
  const viewItems: CaptureInboxViewItem[] = items.map((item) => ({
    ...item,
    capturedLabel: new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(item.capturedAt)),
    canUndo:
      item.stage === "committed" &&
      item.undoExpiresAt !== null,
  }));

  return (
    <>
      <PageHeader
        eyebrow="CAPTURE → REVIEW → COMMIT"
        title="Capture Inbox"
        description="Raw input stays intact. Proposals are editable, nothing commits silently, and recent task creation can be undone safely."
      />
      <div className={styles.layout}>
        <CaptureComposer />
        <CaptureInbox items={viewItems} />
      </div>
    </>
  );
}
