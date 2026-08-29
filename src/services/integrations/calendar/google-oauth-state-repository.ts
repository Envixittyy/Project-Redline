import "server-only";

import { decryptCredential } from "@/services/integrations/credential";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";

export async function saveGoogleOAuthState(input: {
  encryptedVerifier: string;
  expiresAt: string;
  stateHash: string;
}): Promise<void> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const cleanup = await client
    .from("calendar_oauth_states")
    .delete()
    .eq("user_id", userId)
    .lt("expires_at", new Date().toISOString());
  if (cleanup.error) throw cleanup.error;
  const { error } = await client.from("calendar_oauth_states").insert({
    state_hash: input.stateHash,
    user_id: userId,
    provider: "google",
    encrypted_pkce_verifier: input.encryptedVerifier,
    expires_at: input.expiresAt,
  });
  if (error) throw error;
}

/** Delete-and-return makes state consumption one-time under concurrent callbacks. */
export async function consumeGoogleOAuthState(stateHash: string): Promise<string> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client
    .from("calendar_oauth_states")
    .delete()
    .eq("state_hash", stateHash)
    .eq("user_id", userId)
    .eq("provider", "google")
    .gt("expires_at", new Date().toISOString())
    .select("encrypted_pkce_verifier")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Google authorization state is invalid or expired.");
  return decryptCredential(data.encrypted_pkce_verifier);
}
