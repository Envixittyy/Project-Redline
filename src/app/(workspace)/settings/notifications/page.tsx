import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { NotificationPreferences } from "@/features/notifications/notification-preferences";

export const metadata: Metadata = {
  title: "Notification Preferences",
};

export default function NotificationSettingsPage() {
  return (
    <>
      <PageHeader
        title="Notification Preferences"
        description="Choose what Redline surfaces and configure quiet hours."
      />
      <NotificationPreferences />
    </>
  );
}

