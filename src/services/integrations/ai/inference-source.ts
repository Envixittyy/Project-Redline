import "server-only";
import { createHash } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { readTaskChecklistContext } from "@/services/tasks/task-repository";
import { AiTrustError, checklistPrompt, uuid } from "./trust-contract";
import { courseImportPrompt } from "./course-import-contract";
import { schedulePrompt } from "./school-schedule-contract";
import { blackboardCoursePrompt } from "./blackboard-screenshot-contract";
import { academicCalendarPrompt } from "./academic-calendar-contract";
import { assessmentPredictionPrompt } from "./assessment-prediction-contract";
import { capabilityFor, type RequestKind } from "./routing-contract";

export async function readInferenceSource(kind: RequestKind, requestId: unknown, model: string) {
  const capability = capabilityFor(kind);
  const { client, userId } = await requireAuthenticatedSupabase();
  const tableName = kind === "checklist" ? "ai_requests" : kind === "course" ? "ai_course_requests" : "ai_scoped_requests";
  const { data, error } = await client.from(tableName)
    .select(kind === "checklist" ? "task_id,task_handle,source_revision,capability,status,expires_at" : "source_text,source_digest,source_handle,capability,status,expires_at")
    .eq("id", uuid(requestId)).eq("user_id", userId).maybeSingle();
  const r = data as Record<string, string> | null;
  if (error || !r || r.status !== "prepared" || r.capability !== capability.id || Date.parse(r.expires_at) <= Date.now()) throw new AiTrustError("request_unavailable");
  let prompt;
  let transferBytes: number | undefined;
  if (kind === "checklist") {
    const context = await readTaskChecklistContext(r.task_id);
    if (context.revision !== r.source_revision) throw new AiTrustError("source_changed");
    prompt = checklistPrompt(context, r.task_handle);
  } else if (kind === "course") {
    if (createHash("sha256").update(r.source_text).digest("hex") !== r.source_digest) throw new AiTrustError("source_changed");
    prompt = courseImportPrompt(r.source_text, r.source_handle);
  } else if (kind === "schedule_image" || kind === "blackboard_image") {
    if (createHash("sha256").update(r.source_text).digest("hex") !== r.source_digest) throw new AiTrustError("source_changed");
    let authority: { disclosureId?: unknown; imageDigest?: unknown; imageBytes?: unknown };
    try { authority = JSON.parse(r.source_text); } catch { throw new AiTrustError("source_changed"); }
    if (typeof authority.disclosureId !== "string" || typeof authority.imageDigest !== "string" || !/^[a-f0-9]{64}$/.test(authority.imageDigest) ||
        typeof authority.imageBytes !== "number" || !Number.isInteger(authority.imageBytes) || authority.imageBytes < 1 || authority.imageBytes > 5 * 1024 * 1024)
      throw new AiTrustError("source_changed");
    transferBytes = authority.imageBytes;
    prompt = kind === "schedule_image" ? schedulePrompt(r.source_handle) : blackboardCoursePrompt(r.source_handle);
  } else if (kind === "academic_calendar") {
    if (createHash("sha256").update(r.source_text).digest("hex") !== r.source_digest) throw new AiTrustError("source_changed");
    if (r.source_text.startsWith("data:image/")) {
      const match = r.source_text.match(/^data:(image\/[a-z]+);base64,(.+)$/);
      if (!match) throw new AiTrustError("source_changed");
      prompt = academicCalendarPrompt(r.source_handle, { image: { base64: match[2], mimeType: match[1] } });
    } else {
      prompt = academicCalendarPrompt(r.source_handle, { text: r.source_text });
    }
  } else if (kind === "assessment_prediction") {
    if (createHash("sha256").update(r.source_text).digest("hex") !== r.source_digest) throw new AiTrustError("source_changed");
    prompt = assessmentPredictionPrompt(r.source_handle, r.source_text);
  } else if (
    kind === "note_summary" ||
    kind === "note_rewrite" ||
    kind === "note_action_items" ||
    kind === "quick_capture" ||
    kind === "daily_plan_advice" ||
    kind === "material_summary" ||
    kind === "material_study_questions" ||
    kind === "contextual_assistant"
  ) {
    if (createHash("sha256").update(r.source_text).digest("hex") !== r.source_digest) throw new AiTrustError("source_changed");
    try {
      prompt = JSON.parse(r.source_text);
    } catch {
      throw new AiTrustError("source_changed");
    }
  } else {
    throw new AiTrustError("capability_denied");
  }

  const inference = { ...prompt, model };
  // Stable insertion order, versioned and fixture-tested. Provider and capability are
  // separately immutable columns; the digest binds every transmitted inference field.
  const payload = JSON.stringify({ version: 1, capability: capability.id, inference });
  let disclosureId: string | undefined;
  if (kind === "schedule_image" || kind === "blackboard_image") disclosureId = (JSON.parse(r.source_text) as { disclosureId: string }).disclosureId;
  return { inference, digest: createHash("sha256").update(payload).digest("hex"), bytes: Buffer.byteLength(payload), transferBytes, expiresAt: r.expires_at as string, disclosureId };
}
