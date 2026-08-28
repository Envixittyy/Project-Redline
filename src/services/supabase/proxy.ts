import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseConfigured, readPublicSupabaseConfig } from "./public-config";

/** Refresh auth cookies before route rendering. Authorization still happens in the DAL/layout. */
export async function refreshSupabaseSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  if (!isSupabaseConfigured()) return response;

  const { url, publishableKey } = readPublicSupabaseConfig();
  const client = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [name, value] of Object.entries(headers)) {
          response.headers.set(name, value);
        }
      },
    },
  });

  // Initializes and refreshes the cookie session using verified JWT claims.
  await client.auth.getClaims();
  return response;
}
