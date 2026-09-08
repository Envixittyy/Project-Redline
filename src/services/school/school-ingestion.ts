import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedSchoolEvent, SchoolIngestionResult } from "@/types/school-item";

/** Transaction boundary shared by the verified webhook and fixture integration tests. */
export async function ingestSchoolEvent(client: Pick<SupabaseClient, "rpc">, userId: string, event: ParsedSchoolEvent): Promise<SchoolIngestionResult> {
  const { data, error } = await client.rpc("ingest_school_email", { p_user_id: userId, p_event: event });
  if (error || !data) throw new Error("school_ingestion_failed");
  return data as SchoolIngestionResult;
}
