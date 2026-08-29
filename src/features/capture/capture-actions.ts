"use server";

import { revalidatePath } from "next/cache";

import {
  acknowledgeProposalDivergence,
  commitCaptureTask,
  createTextCapture,
  dismissCaptureProposal,
  prepareCaptureTask,
  undoCaptureTask,
} from "@/services/captures/capture-repository";
import { authFailureMessage, SupabaseNotConfiguredError } from "@/services/supabase/errors";

export type CaptureActionResult = { ok: true } | { ok: false; message: string };

class InvalidCaptureInputError extends Error {}

function requireId(value: unknown, label = "That item"): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidCaptureInputError(`${label} could not be identified.`);
  }
  return value;
}

function requireText(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidCaptureInputError("Write something to capture first.");
  }
  const text = value.trim();
  if (text.length > 10000) {
    throw new InvalidCaptureInputError("Captures are limited to 10,000 characters.");
  }
  return text;
}

function requireTitle(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidCaptureInputError("Give the proposed task a title.");
  }
  const title = value.trim();
  if (title.length > 200) {
    throw new InvalidCaptureInputError("Task titles are limited to 200 characters.");
  }
  return title;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function revalidateCaptureConsumers() {
  revalidatePath("/inbox");
  revalidatePath("/tasks");
  revalidatePath("/calendar");
  revalidatePath("/focus");
  revalidatePath("/");
}

function toFailure(error: unknown): CaptureActionResult {
  if (error instanceof InvalidCaptureInputError) return { ok: false, message: error.message };
  if (error instanceof SupabaseNotConfiguredError) {
    return { ok: false, message: "Supabase is not configured, so captures cannot be saved yet." };
  }
  const authMessage = authFailureMessage(error);
  if (authMessage) return { ok: false, message: authMessage };
  console.error("[captures] action failed:", error);
  return {
    ok: false,
    message: error instanceof Error ? error.message : "Something went wrong. Please try again.",
  };
}

export async function createCaptureAction(text: unknown): Promise<CaptureActionResult> {
  try {
    await createTextCapture(requireText(text));
    revalidateCaptureConsumers();
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function prepareCaptureTaskAction(captureId: unknown): Promise<CaptureActionResult> {
  try {
    await prepareCaptureTask(requireId(captureId, "That capture"));
    revalidatePath("/inbox");
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function commitCaptureTaskAction(
  captureId: unknown,
  proposalId: unknown,
  title: unknown,
  description?: unknown,
  dueDate?: unknown,
  dueAt?: unknown,
  courseId?: unknown,
): Promise<CaptureActionResult> {
  try {
    await commitCaptureTask(
      requireId(captureId, "That capture"),
      requireId(proposalId, "That proposal"),
      requireTitle(title),
      optionalString(description),
      optionalString(dueDate),
      optionalString(dueAt),
      optionalString(courseId),
    );
    revalidateCaptureConsumers();
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function dismissProposalAction(proposalId: unknown): Promise<CaptureActionResult> {
  try {
    await dismissCaptureProposal(requireId(proposalId, "That proposal"));
    revalidateCaptureConsumers();
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function acknowledgeProposalDivergenceAction(
  proposalId: unknown,
): Promise<CaptureActionResult> {
  try {
    await acknowledgeProposalDivergence(requireId(proposalId, "That proposal"));
    revalidateCaptureConsumers();
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function undoCaptureTaskAction(captureId: unknown): Promise<CaptureActionResult> {
  try {
    await undoCaptureTask(requireId(captureId, "That capture"));
    revalidateCaptureConsumers();
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}
