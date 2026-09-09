import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { BlackboardPanel } from "@/features/integrations/blackboard-panel";
import { getBlackboardStatus } from "@/services/integrations/blackboard/blackboard-repository";
import { isSupabaseConfigured } from "@/services/supabase/public-config";

export const metadata: Metadata = { title: "Blackboard integration" };
export default async function BlackboardPage() {
  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader
          title="Blackboard"
          description="S1 notification-email ingestion with optional S2 current-state observation."
        />
        <Surface variant="glass" style={{ padding: "1rem" }}>
          Configure Supabase before connecting Blackboard.
        </Surface>
      </>
    );
  }

  const status = await getBlackboardStatus();

  return (
    <>
      <PageHeader
        title="Blackboard"
        description="S1 notification-email ingestion plus fail-closed S2 calendar observation and reconciliation."
      />
      <BlackboardPanel
        status={status}
        pushConfigured={Boolean(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
        )}
      />
    </>
  );
}
