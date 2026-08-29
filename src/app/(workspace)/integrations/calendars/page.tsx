import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { calendarProviderCatalog } from "@/services/integrations/calendar/provider-catalog";
import { isGoogleCalendarOAuthConfigured } from "@/services/integrations/calendar/google-oauth";
import { listExternalCalendarConnections } from "@/services/external-calendars/external-calendar-repository";
import { isSupabaseConfigured } from "@/services/supabase/public-config";

import styles from "./calendars-page.module.css";

export const metadata: Metadata = { title: "Calendar connections" };

export default async function CalendarConnectionsPage({ searchParams }: PageProps<"/integrations/calendars">) {
  const params = await searchParams;
  const googleResult = Array.isArray(params.google) ? params.google[0] : params.google;
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
          <Surface variant="subtle" className={styles.notice} role="status">
            <h2>Google Calendar connected</h2>
            <p>The credential is encrypted. Calendar discovery and event synchronization are the next server-owned operations.</p>
          </Surface>
        ) : null}
        {googleResult && googleResult !== "connected" ? (
          <Surface variant="subtle" className={styles.notice} role="alert">
            <h2>Google Calendar was not connected</h2>
            <p>The request was denied, expired, or could not be exchanged. No provider error detail or credential was stored in the browser.</p>
          </Surface>
        ) : null}
        {failure ? (
          <Surface variant="subtle" className={styles.notice} role="alert">
            <h2>Connections are not available yet</h2>
            <p>{failure} Apply the latest P3 migration before connecting a provider.</p>
          </Surface>
        ) : null}
        <Surface variant="glass" className={styles.summary}>
          <h2>{connections.filter((connection) => connection.status === "connected").length} connected</h2>
          <p>OAuth and credential setup is intentionally unavailable until its server callback and secret configuration are complete.</p>
        </Surface>
        <section className={styles.providerGrid} aria-label="External calendar providers">
          {calendarProviderCatalog.map((provider) => {
            const connection = byProvider.get(provider.id);
            const connected = connection?.status === "connected";
            return (
              <Surface key={provider.id} variant="base" className={styles.providerCard}>
                <div className={styles.providerHeading}>
                  <h2>{provider.label}</h2>
                  <span className={styles.status} data-connected={connected || undefined}>
                    {connection?.status ?? "Not configured"}
                  </span>
                </div>
                <p>{provider.description}</p>
                <div className={styles.providerMeta}>
                  <span className={styles.kind}>{provider.connectionKind}</span>
                  <span>{connection?.access.replace("_", " ") ?? "No access granted"}</span>
                </div>
                {connection?.capabilities.length ? (
                  <div className={styles.capabilities} aria-label={`${provider.label} capabilities`}>
                    {connection.capabilities.map((capability) => (
                      <span className={styles.capability} key={capability}>{capability.replaceAll("_", " ")}</span>
                    ))}
                  </div>
                ) : null}
                {provider.id === "google" && !connected ? (
                  isGoogleCalendarOAuthConfigured() ? (
                    <Link className={styles.connectLink} href="/api/integrations/calendar/google/start">Connect read-only</Link>
                  ) : (
                    <p className={styles.setupHint}>Set APP_ORIGIN and the two GOOGLE_CALENDAR_* server variables to enable OAuth.</p>
                  )
                ) : null}
              </Surface>
            );
          })}
        </section>
      </div>
    </>
  );
}
