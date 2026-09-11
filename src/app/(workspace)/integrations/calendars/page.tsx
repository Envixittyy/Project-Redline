import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { syncGoogleCalendarAction } from "@/features/integrations/google-calendar-actions";
import { calendarProviderCatalog } from "@/services/integrations/calendar/provider-catalog";
import { isGoogleCalendarOAuthConfigured } from "@/services/integrations/calendar/google-oauth";
import { hasCalendarCapabilities } from "@/services/integrations/calendar/provider-contract";
import { listExternalCalendarConnections } from "@/services/external-calendars/external-calendar-repository";
import { isSupabaseConfigured } from "@/services/supabase/public-config";

import styles from "./calendars-page.module.css";

export const metadata: Metadata = { title: "Calendar connections" };

export default async function CalendarConnectionsPage({ searchParams }: PageProps<"/integrations/calendars">) {
  const params = await searchParams;
  const googleResult = Array.isArray(params.google) ? params.google[0] : params.google;
  const googleSync = Array.isArray(params.googleSync) ? params.googleSync[0] : params.googleSync;
  const googleSyncSummary = parseGoogleSyncSummary(googleSync);
  let connections: Awaited<ReturnType<typeof listExternalCalendarConnections>> = [];
  let failure: string | null = null;

  if (isSupabaseConfigured()) {
    try {
      connections = await listExternalCalendarConnections();
    } catch (error) {
      failure = error instanceof Error ? error.message : "Calendar connections could not be loaded.";
    }
  }

  const byProvider = new Map(connections.map((connection) => [connection.provider, connection]));

  return (
    <>
      <PageHeader
        eyebrow="SOURCE-AWARE BY DEFAULT"
        title="Calendar connections"
        description="External calendars remain fixed provider records. Their declared capabilities decide what Forward may read or change."
      />
      <div className={styles.layout}>
        {googleResult === "connected" ? (
          <Callout tone="success" title="Google Calendar connected">
            The credential is encrypted. Use Sync now to discover calendars and refresh the source-aware mirror.
          </Callout>
        ) : null}
        {googleResult && googleResult !== "connected" ? (
          <Callout tone="error" title="Google Calendar was not connected">
            The request was denied, expired, or could not be exchanged. No provider error detail or credential was stored in the browser.
          </Callout>
        ) : null}
        {googleSyncSummary ? (
          <Callout tone="success" title="Google Calendar synchronized">
            {googleSyncSummary}
          </Callout>
        ) : null}
        {googleSync === "busy" ? (
          <Callout tone="warning" title="Credential refresh is already running">
            Wait a moment, then synchronize again. The existing calendar mirror was not cleared.
          </Callout>
        ) : null}
        {googleSync === "failed" ? (
          <Callout tone="error" title="Google Calendar sync needs attention">
            No provider error detail or credential was exposed. Reconnect if the saved authorization has expired.
          </Callout>
        ) : null}
        {failure ? (
          <Callout tone="error" title="Connections are not available yet">
            {failure} Apply the latest P3 migration before connecting a provider.
          </Callout>
        ) : null}
        <Surface variant="glass" className={styles.summary}>
          <h2>{connections.filter((connection) => connection.status === "connected").length} connected</h2>
          <p>Credentials and provider cursors stay encrypted server-side; this page receives status and safe result counts only.</p>
        </Surface>
        <section className={styles.providerGrid} aria-label="External calendar providers">
          {calendarProviderCatalog.map((provider) => {
            const connection = byProvider.get(provider.id);
            const connected = connection?.status === "connected";
            const canSync = connected && hasCalendarCapabilities(
              connection.capabilities,
              ["list_calendars", "list_events"],
            );
            return (
              <Surface key={provider.id} variant="base" className={styles.providerCard}>
                <div className={styles.providerHeading}>
                  <h2>{provider.label}</h2>
                  <Badge tone={connected ? "success" : "neutral"} size="sm">
                    {connection?.status ?? "Not configured"}
                  </Badge>
                </div>
                <p>{provider.description}</p>
                <div className={styles.providerMeta}>
                  <Badge tone="neutral" size="sm">{provider.connectionKind}</Badge>
                  <span>{connection?.access.replace("_", " ") ?? "No access granted"}</span>
                </div>
                {connection?.capabilities.length ? (
                  <div className={styles.capabilities} aria-label={`${provider.label} capabilities`}>
                    {connection.capabilities.map((capability) => (
                      <Badge tone="neutral" size="sm" key={capability}>
                        {capability.replaceAll("_", " ")}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {provider.id === "google" && !connected ? (
                  isGoogleCalendarOAuthConfigured() ? (
                    <Link className={styles.connectLink} href="/api/integrations/calendar/google/start">
                      Connect read-only
                    </Link>
                  ) : (
                    <p className={styles.setupHint}>Set APP_ORIGIN and the two GOOGLE_CALENDAR_* server variables to enable OAuth.</p>
                  )
                ) : null}
                {provider.id === "google" && canSync ? (
                  <form action={syncGoogleCalendarAction} className={styles.actionForm}>
                    <Button type="submit" variant="secondary" size="md" className={styles.syncButton}>
                      Sync now
                    </Button>
                  </form>
                ) : null}
              </Surface>
            );
          })}
        </section>
      </div>
    </>
  );
}

function parseGoogleSyncSummary(value: string | undefined): string | null {
  const match = /^complete:(\d+):(\d+):(\d+):(\d+)$/.exec(value ?? "");
  if (!match) return null;
  const [, calendars, events, cancelled, missing] = match;
  return `${calendars} calendars checked · ${events} events mirrored · ${cancelled} cancellations · ${missing} missing-source records retained.`;
}
