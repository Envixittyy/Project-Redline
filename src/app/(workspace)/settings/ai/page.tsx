import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { AiSettingsPanel } from "@/features/ai/ai-settings-panel";
import { getAiPreferences } from "@/services/integrations/ai/ai-repository";
import { isSupabaseConfigured } from "@/services/supabase/public-config";

export const metadata: Metadata = { title: "AI Settings" };

export default async function AiSettingsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader
          title="AI Settings"
          description="Privacy boundaries and provider configuration."
        />
        <Surface variant="glass" style={{ padding: "1rem" }}>
          Configure Supabase before managing AI settings.
        </Surface>
      </>
    );
  }

  const preferences = await getAiPreferences();

  return (
    <>
      <PageHeader
        title="AI Settings"
        description="Privacy boundaries, cloud provider selection, and data transfer controls."
      />
      <AiSettingsPanel preferences={preferences} />
    </>
  );
}
