import type { Metadata } from "next";

import { Callout } from "@/components/ui/callout";
import { PageHeader } from "@/components/ui/page-header";
import { AiSettingsPanel } from "@/features/ai/ai-settings-panel";
import { getAiPreferences } from "@/services/integrations/ai/ai-repository";
import { isSupabaseConfigured } from "@/services/supabase/public-config";
import { cloudAvailability } from "@/services/integrations/ai/cloud-provider";

export const metadata: Metadata = { title: "AI Settings" };

export default async function AiSettingsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader
          title="AI Settings"
          description="Privacy boundaries and provider configuration."
        />
        <Callout variant="warning" title="Supabase Required">
          Configure Supabase before managing AI settings.
        </Callout>
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
      <AiSettingsPanel preferences={preferences} providers={{ gemini: cloudAvailability("gemini"), openrouter: cloudAvailability("openrouter") }} />
    </>
  );
}
