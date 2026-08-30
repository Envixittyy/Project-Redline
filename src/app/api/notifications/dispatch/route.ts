import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { evaluateAndDispatchNotifications } from "@/services/notifications/notification-dispatcher";
import { getSupabaseAdminClient } from "@/services/supabase/admin";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";

function isAuthorizedCron(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecretHeader = request.headers.get("x-cron-secret");

  const validSecrets = [
    process.env.CRON_SECRET,
    process.env.NOTIFICATION_DISPATCH_SECRET,
  ].flatMap((value) => {
    const secret = value?.trim();
    return secret ? [secret] : [];
  });

  if (validSecrets.length === 0) {
    return false;
  }

  const bearerMatch = authHeader?.match(/^Bearer ([^\s]+)$/);
  const candidate = bearerMatch?.[1] ?? cronSecretHeader?.trim() ?? "";
  if (!candidate) return false;

  const candidateBuffer = Buffer.from(candidate);
  return validSecrets.some((secret) => {
    const secretBuffer = Buffer.from(secret);
    return (
      candidateBuffer.length === secretBuffer.length &&
      timingSafeEqual(candidateBuffer, secretBuffer)
    );
  });
}

async function handleDispatch(request: Request, allowUserSession: boolean) {
  try {
    // 1. Check if caller has valid cron secret
    if (isAuthorizedCron(request)) {
      const adminClient = getSupabaseAdminClient();

      // Authentication is the authoritative user registry. A newly registered
      // device must be dispatchable even before its owner saves preferences.
      const { data: authUsers, error } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 10,
      });

      if (error) throw error;

      const userIds = authUsers.users.map((user) => user.id);

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

    if (!allowUserSession) {
      return NextResponse.json(
        { ok: false, message: "Unauthorized notification dispatch request." },
        { status: 401 },
      );
    }

    // 2. POST-only fallback: authenticated user session, scoped to that owner.
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
  return handleDispatch(request, true);
}

export async function GET(request: Request) {
  return handleDispatch(request, false);
}
