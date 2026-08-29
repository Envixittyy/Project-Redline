import { NextResponse, type NextRequest } from "next/server";

import { saveGoogleCalendarConnection } from "@/services/external-calendars/external-calendar-repository";
import {
  applicationOrigin,
  exchangeGoogleAuthorizationCode,
  hashOAuthState,
} from "@/services/integrations/calendar/google-oauth";
import { consumeGoogleOAuthState } from "@/services/integrations/calendar/google-oauth-state-repository";

export const runtime = "nodejs";

function resultUrl(result: "connected" | "denied" | "invalid" | "exchange_failed"): URL {
  return new URL(`/integrations/calendars?google=${result}`, applicationOrigin());
}

export async function GET(request: NextRequest) {
  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) return NextResponse.redirect(resultUrl("denied"));

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state) return NextResponse.redirect(resultUrl("invalid"));

  try {
    const verifier = await consumeGoogleOAuthState(hashOAuthState(state));
    const credential = await exchangeGoogleAuthorizationCode(code, verifier);
    await saveGoogleCalendarConnection(credential);
  } catch (error) {
    console.error("[google-calendar] authorization callback failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.redirect(resultUrl("exchange_failed"));
  }

  return NextResponse.redirect(resultUrl("connected"));
}
