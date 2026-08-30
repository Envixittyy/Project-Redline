import { NextResponse } from "next/server";

import { evaluateAndDispatchNotifications } from "@/services/notifications/notification-dispatcher";
import { getSupabaseAdminClient } from "@/services/supabase/admin";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";

function isAuthorizedCron(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecretHeader = request.headers.get("x-cron-secret");

  const validSecrets = [
    process.env.CRON_SECRET,
    process.env.NOTIFICATION_DISPATCH_SECRET,
    process.env.INTERNAL_CRON_SECRET,
  ].filter(Boolean) as string[];

  if (validSecrets.length === 0) {
    return false;
  }

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (validSecrets.includes(token)) return true;
  }

  if (cronSecretHeader && validSecrets.includes(cronSecretHeader.trim())) {
    return true;
  }

  return false;
}

async function handleDispatch(request: Request) {
  try {
    // 1. Check if caller has valid cron secret
    if (isAuthorizedCron(request)) {
      const adminClient = getSupabaseAdminClient();

      // For single-user Redline, find user from preferences or auth users
      const { data: prefUsers, error } = await adminClient
        .from("notification_preferences")
        .select("user_id")
        .limit(10);

      if (error) throw error;

      const userIds = Array.from(
        new Set((prefUsers ?? []).map((p: { user_id: string }) => p.user_id)),
      );

      const summaries = [];
      for (const uid of userIds) {
        const summary = await evaluateAndDispatchNotifications(
          adminClient as unknown as Parameters<typeof evaluateAndDispatchNotifications>[0],
          uid,
        );
        summaries.push({ userId: uid, ...summary });
      }

      return NextResponse.json({
        ok: true,
        authenticatedVia: "cron_secret",
        usersProcessed: userIds.length,
        results: summaries,
      });
    }

    // 2. Fallback: Authenticated user session
    const { client, userId } = await requireAuthenticatedSupabase();
    const summary = await evaluateAndDispatchNotifications(client, userId);

    return NextResponse.json({
      ok: true,
      authenticatedVia: "user_session",
      userId,
      ...summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not authenticated") || message.includes("Unauthorized")) {
      return NextResponse.json(
        { ok: false, message: "Unauthorized notification dispatch request." },
        { status: 401 },
      );
    }

    console.error("[dispatch-route] Error during notification dispatch:", err);
    return NextResponse.json(
      { ok: false, message: "Notification dispatch failed." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handleDispatch(request);
}

export async function GET(request: Request) {
  return handleDispatch(request);
}
