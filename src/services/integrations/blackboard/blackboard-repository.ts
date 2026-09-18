import "server-only";

import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { listSchoolEmailEvents } from "@/services/school/school-repository";
import type { SchoolEmailEvent } from "@/types/school-item";

export type BlackboardEmailStatus = {
  configured: boolean;
  eventCounts: {
    total: number;
    processed: number;
    unresolved: number;
    ignored: number;
    other: number;
  };
  latestEvent: {
    receivedAt: string;
    status: string;
    itemType?: string | null;
    title?: string | null;
  } | null;
  recentEvents: SchoolEmailEvent[];
  courseMappingIssues: SchoolEmailEvent[];
  courses: Array<{ id: string; code: string; name: string; color: string | null }>;
};

/**
 * Checks whether inbound email ingestion is configured on the server.
 * Never returns secret keys or sender addresses.
 */
export function isBlackboardEmailConfigured(): boolean {
  const hosts = (process.env.SCHOOL_BLACKBOARD_HOSTS ?? "").trim();
  const hasWebhookSecret = Boolean(
    process.env.RESEND_INBOUND_WEBHOOK_SECRET || process.env.POSTMARK_INBOUND_WEBHOOK_SECRET,
  );
  return Boolean(hosts && hasWebhookSecret);
}

export async function getBlackboardStatus(): Promise<BlackboardEmailStatus> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const [events, coursesResult] = await Promise.all([
    listSchoolEmailEvents(),
    client
      .from("courses")
      .select("id,code,name,color")
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("code", { ascending: true }),
  ]);

  if (coursesResult.error) {
    throw coursesResult.error;
  }

  const courses = (coursesResult.data ?? []) as Array<{
    id: string;
    code: string;
    name: string;
    color: string | null;
  }>;

  const eventCounts = {
    total: events.length,
    processed: 0,
    unresolved: 0,
    ignored: 0,
    other: 0,
  };

  const courseMappingIssues: SchoolEmailEvent[] = [];

  for (const event of events) {
    if (event.status === "processed") {
      eventCounts.processed += 1;
    } else if (event.status.startsWith("unresolved_")) {
      eventCounts.unresolved += 1;
      if (event.status === "unresolved_course") {
        courseMappingIssues.push(event);
      }
    } else if (event.status === "ignored" || event.status === "stale") {
      eventCounts.ignored += 1;
    } else {
      eventCounts.other += 1;
    }
  }

  const latest = events[0] ?? null;
  const latestParsed = latest?.parsedEvent as
    | { itemType?: string; title?: string }
    | undefined;

  return {
    configured: isBlackboardEmailConfigured(),
    eventCounts,
    latestEvent: latest
      ? {
          receivedAt: latest.receivedAt,
          status: latest.status,
          itemType: latestParsed?.itemType ?? null,
          title: latestParsed?.title ?? null,
        }
      : null,
    recentEvents: events.slice(0, 20),
    courseMappingIssues,
    courses,
  };
}
