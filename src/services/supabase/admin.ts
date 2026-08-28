import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { SupabaseNotConfiguredError } from "./errors";

let adminClient: SupabaseClient | null = null;

/**
 * Privileged maintenance client. Feature repositories must never import this
 * module; normal application traffic uses the request-scoped SSR client.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing: string[] = [];

  if (!url) missing.push("SUPABASE_URL");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) throw new SupabaseNotConfiguredError(missing);

  adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}
