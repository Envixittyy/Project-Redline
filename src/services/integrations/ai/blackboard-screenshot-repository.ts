import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { validateImageBuffer } from "@/services/documents/image-validator";
import {
  BLACKBOARD_COURSE_IMAGE_CAPABILITY,
  blackboardCoursePrompt,
  parseBlackboardCourseOutput,
  type BlackboardCourseReview,
} from "./blackboard-screenshot-contract";
import { AiTrustError, uuid } from "./trust-contract";

export async function prepareBlackboardScreenshotImport(
  formData: FormData,
  provider: string,
  model: string,
) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const file = formData.get("file") as File | null;
  if (!file) throw new AiTrustError("invalid_request");

  const buffer = Buffer.from(await file.arrayBuffer());
  const validatedImage = validateImageBuffer(buffer, file.name, file.type);

  const requestId = randomUUID();
  const handle = `bb_image_${randomUUID()}`;
  const sourceText = validatedImage.dataUrl;
  const sourceDigest = createHash("sha256").update(sourceText).digest("hex");
  const promptData = blackboardCoursePrompt(handle, validatedImage.base64, validatedImage.mimeType);

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const { error } = await client.from("ai_course_requests").insert({
    id: requestId,
    user_id: userId,
    capability: BLACKBOARD_COURSE_IMAGE_CAPABILITY.id,
    source_handle: handle,
    file_name: validatedImage.fileName,
    source_text: sourceText,
    source_digest: sourceDigest,
    start_date: new Date().toISOString().slice(0, 10),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    provider,
    model,
    status: "prepared",
    expires_at: expiresAt,
  });

  if (error) throw new AiTrustError("request_unavailable");

  return {
    requestId,
    handle,
    promptData,
    payloadDigest: sourceDigest,
    bytes: validatedImage.byteLength,
    expiresAt,
  };
}

export async function finalizeBlackboardScreenshotImport(
  requestId: string,
  rawOutput: unknown,
): Promise<BlackboardCourseReview> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const { data: request, error: reqError } = await client
    .from("ai_course_requests")
    .select("id,source_handle,file_name,status,expires_at")
    .eq("id", uuid(requestId))
    .eq("user_id", userId)
    .maybeSingle();

  if (reqError || !request || request.status !== "prepared") {
    throw new AiTrustError("request_unavailable");
  }

  const proposal = parseBlackboardCourseOutput(
    rawOutput,
    BLACKBOARD_COURSE_IMAGE_CAPABILITY.id,
    request.source_handle,
  );

  const batchId = randomUUID();

  const { error: batchError } = await client.from("operation_batches").insert({
    id: batchId,
    user_id: userId,
    source: "ai",
    status: "proposed",
    ai_course_request_id: request.id,
  });

  if (batchError) throw new AiTrustError("request_unavailable");

  const { error: stepError } = await client.from("operation_steps").insert({
    id: randomUUID(),
    batch_id: batchId,
    user_id: userId,
    position: 0,
    action_type: BLACKBOARD_COURSE_IMAGE_CAPABILITY.outputType,
    input: proposal,
  });

  if (stepError) throw new AiTrustError("request_unavailable");

  return {
    batchId,
    courses: proposal.courses,
    status: "proposed",
    sourceHandle: request.source_handle,
    fileName: request.file_name,
  };
}

export type BlackboardScreenshotApplyInput = {
  batchId: string;
  courses: Array<{
    sourceLabel: string;
    code: string;
    title: string;
    section?: string;
    action: "create" | "match" | "ignore";
    matchedCourseId?: string;
  }>;
};

export async function applyBlackboardScreenshotImport(input: BlackboardScreenshotApplyInput) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const batchId = uuid(input.batchId);

  const { data: batch, error: batchErr } = await client
    .from("operation_batches")
    .select("id,status,ai_course_request_id")
    .eq("id", batchId)
    .eq("user_id", userId)
    .maybeSingle();

  if (batchErr || !batch || batch.status !== "proposed") {
    throw new Error("Invalid or already applied Blackboard import batch.");
  }

  const createdCourseIds: string[] = [];

  for (const item of input.courses) {
    if (item.action === "ignore") continue;

    let targetCourseId = item.matchedCourseId;

    if (item.action === "create" || !targetCourseId) {
      const { data: newCourse, error: courseErr } = await client
        .from("courses")
        .insert({
          user_id: userId,
          code: item.code.trim(),
          name: item.title.trim(),
          color: "oklch(62% 0.19 255)",
        })
        .select("id")
        .single();

      if (courseErr || !newCourse) {
        throw new Error(`Failed to create course ${item.code}: ${courseErr?.message}`);
      }
      targetCourseId = String(newCourse.id);
      createdCourseIds.push(targetCourseId);
    }

    // Upsert blackboard course mapping if external label exists
    if (item.sourceLabel && targetCourseId) {
      await client
        .from("blackboard_course_mappings")
        .upsert(
          {
            user_id: userId,
            course_id: targetCourseId,
            external_course_id: item.sourceLabel,
            course_name: item.title,
            is_active: true,
          },
          { onConflict: "user_id,external_course_id" },
        );
    }
  }

  await client
    .from("operation_batches")
    .update({ status: "committed" })
    .eq("id", batchId)
    .eq("user_id", userId);

  return { ok: true, createdCourseIds };
}
