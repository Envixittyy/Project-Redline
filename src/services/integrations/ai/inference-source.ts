import "server-only";
import { createHash } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { readTaskChecklistContext } from "@/services/tasks/task-repository";
import { AiTrustError, checklistPrompt, uuid } from "./trust-contract";
import { courseImportPrompt } from "./course-import-contract";
import { capabilityFor, type RequestKind } from "./routing-contract";

export async function readInferenceSource(kind: RequestKind, requestId: unknown, model: string) {
  const capability = capabilityFor(kind);
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client.from(kind === "checklist" ? "ai_requests" : "ai_course_requests")
    .select(kind === "checklist" ? "task_id,task_handle,source_revision,capability,status,expires_at" : "source_text,source_digest,source_handle,capability,status,expires_at")
    .eq("id", uuid(requestId)).eq("user_id", userId).maybeSingle();
  const r = data as Record<string, string> | null;
  if (error || !r || r.status !== "prepared" || r.capability !== capability.id || Date.parse(r.expires_at) <= Date.now()) throw new AiTrustError("request_unavailable");
  let prompt;
  if (kind === "checklist") {
    const context = await readTaskChecklistContext(r.task_id);
    if (context.revision !== r.source_revision) throw new AiTrustError("source_changed");
    prompt = checklistPrompt(context, r.task_handle);
  } else {
    if (createHash("sha256").update(r.source_text).digest("hex") !== r.source_digest) throw new AiTrustError("source_changed");
    prompt = courseImportPrompt(r.source_text, r.source_handle);
  }
  const inference = { ...prompt, model };
  // Stable insertion order, versioned and fixture-tested. Provider and capability are
  // separately immutable columns; the digest binds every transmitted inference field.
  const payload = JSON.stringify({ version: 1, capability: capability.id, inference });
  return { inference, digest: createHash("sha256").update(payload).digest("hex"), bytes: Buffer.byteLength(payload), expiresAt: r.expires_at as string };
}
