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
          description="Automatic school updates from Blackboard notification emails."
        />
        <Surface variant="glass" style={{ padding: "1rem" }}>
          Configure Supabase before viewing Blackboard status.
        </Surface>
      </>
    );
  }

  const status = await getBlackboardStatus();

  return (
    <>
      <PageHeader
        title="Blackboard"
        description="Automatic school updates from Blackboard notification emails."
      />
      <BlackboardPanel status={status} />
    </>
  );
}
