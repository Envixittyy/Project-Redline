import { NextResponse } from "next/server";

import { validateWebPushSubscription } from "@/services/notifications/web-push-client";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { message: "Invalid request origin." },
      { status: 403 },
    );
  }

  try {
    const body = (await request.json()) as {
      endpoint?: unknown;
      expirationTime?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    };

    if (
      typeof body.endpoint !== "string" ||
      typeof body.keys?.p256dh !== "string" ||
      typeof body.keys.auth !== "string" ||
      validateWebPushSubscription({
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      })
    ) {
      return NextResponse.json(
        { message: "Invalid browser push subscription." },
        { status: 400 },
      );
    }

    const expirationTime =
      typeof body.expirationTime === "number" &&
      Number.isFinite(body.expirationTime) &&
      body.expirationTime > Date.now()
        ? new Date(body.expirationTime).toISOString()
        : null;
    const { client, userId } = await requireAuthenticatedSupabase();
    const device = await client
      .from("devices")
      .insert({
        user_id: userId,
        name: "Web device",
        user_agent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
      })
      .select("id")
      .single();

    if (device.error) throw device.error;

    const saved = await client.from("push_subscriptions").upsert(
      {
        user_id: userId,
        device_id: device.data.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        expires_at: expirationTime,
        disabled_at: null,
      },
      { onConflict: "user_id,endpoint" },
    );

    if (saved.error) throw saved.error;
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error(
      "[push] subscription failed:",
      error instanceof Error ? error.name : "unknown_error",
    );
    return NextResponse.json(
      { message: "Push subscription could not be saved." },
      { status: 500 },
    );
  }
}
