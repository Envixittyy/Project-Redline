import { NextResponse } from "next/server";

import {
  applicationOrigin,
  createGoogleAuthorizationRequest,
} from "@/services/integrations/calendar/google-oauth";
import { saveGoogleOAuthState } from "@/services/integrations/calendar/google-oauth-state-repository";

export const runtime = "nodejs";

export async function GET() {
  let fallbackOrigin = "http://localhost:3000";
  try {
    fallbackOrigin = applicationOrigin();
    const authorization = createGoogleAuthorizationRequest();
    await saveGoogleOAuthState(authorization);
    return NextResponse.redirect(authorization.authorizationUrl);
  } catch (error) {
    console.error("[google-calendar] authorization start failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.redirect(new URL("/integrations/calendars?google=start_failed", fallbackOrigin));
  }
}
