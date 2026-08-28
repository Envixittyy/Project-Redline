"use client";

import { createBrowserClient } from "@supabase/ssr";

import { readPublicSupabaseConfig } from "./public-config";

/** Browser client for features that genuinely need direct client-side Supabase APIs. */
export function createBrowserSupabaseClient() {
  const { url, publishableKey } = readPublicSupabaseConfig();
  return createBrowserClient(url, publishableKey);
}
