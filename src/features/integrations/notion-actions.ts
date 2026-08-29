"use server";

import { revalidatePath } from "next/cache";

import {
  connectNotionAccount,
  disconnectNotionAccount,
  exportNoteToNotion,
  resolveNotionConflict,
  syncNoteWithNotion,
  unlinkNotionPage,
  updateNotionLinkDirection,
} from "@/services/integrations/notion/notion-repository";
import type {
  NotionConflictResolution,
  NotionSyncDirection,
} from "@/services/integrations/notion/types";
import { authFailureMessage } from "@/services/supabase/errors";

function refresh() {
  revalidatePath("/integrations/notion");
  revalidatePath("/notes");
  revalidatePath("/more");
}

function handleActionResult(error: unknown): { ok: false; message: string } {
  const authMsg = authFailureMessage(error);
  if (authMsg) return { ok: false, message: authMsg };
  console.error("[notion-actions] error:", error);
  return {
    ok: false,
    message: error instanceof Error ? error.message : "An unexpected error occurred.",
  };
}

export async function connectNotionAction(
  token: unknown,
  credentialHint?: unknown,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (typeof token !== "string" || !token.trim()) {
      return { ok: false, message: "A Notion integration token is required." };
    }
    const hint = typeof credentialHint === "string" ? credentialHint.trim() : undefined;
    const result = await connectNotionAccount(token.trim(), hint);
    if (result.ok) refresh();
    return result;
  } catch (error) {
    return handleActionResult(error);
  }
}

export async function disconnectNotionAction(): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await disconnectNotionAccount();
    if (result.ok) refresh();
    return result;
  } catch (error) {
    return handleActionResult(error);
  }
}

export async function exportNoteToNotionAction(
  noteId: unknown,
  parentPageId: unknown,
  direction?: unknown,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (typeof noteId !== "string" || !noteId.trim()) {
      return { ok: false, message: "A valid note ID is required." };
    }
    if (typeof parentPageId !== "string" || !parentPageId.trim()) {
      return { ok: false, message: "A target Notion Parent Page ID is required." };
    }
    const dir =
      direction === "selective_two_way" ? ("selective_two_way" as NotionSyncDirection) : ("forward_to_notion" as NotionSyncDirection);

    const result = await exportNoteToNotion(noteId.trim(), parentPageId.trim(), dir);
    if (result.ok) refresh();
    return result;
  } catch (error) {
    return handleActionResult(error);
  }
}

export async function syncNoteAction(noteId: unknown): Promise<{ ok: boolean; message: string }> {
  try {
    if (typeof noteId !== "string" || !noteId.trim()) {
      return { ok: false, message: "A valid note ID is required." };
    }
    const result = await syncNoteWithNotion(noteId.trim());
    if (result.ok) refresh();
    return result;
  } catch (error) {
    return handleActionResult(error);
  }
}

export async function resolveNotionConflictAction(
  conflictId: unknown,
  resolution: unknown,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (typeof conflictId !== "string" || !conflictId.trim()) {
      return { ok: false, message: "A valid conflict ID is required." };
    }
    if (resolution !== "keep_redline" && resolution !== "use_notion") {
      return { ok: false, message: "A valid resolution choice is required." };
    }
    const result = await resolveNotionConflict(
      conflictId.trim(),
      resolution as NotionConflictResolution,
    );
    if (result.ok) refresh();
    return result;
  } catch (error) {
    return handleActionResult(error);
  }
}

export async function unlinkNoteAction(noteId: unknown): Promise<{ ok: boolean; message: string }> {
  try {
    if (typeof noteId !== "string" || !noteId.trim()) {
      return { ok: false, message: "A valid note ID is required." };
    }
    const result = await unlinkNotionPage(noteId.trim());
    if (result.ok) refresh();
    return result;
  } catch (error) {
    return handleActionResult(error);
  }
}

export async function updateNotionLinkDirectionAction(
  noteId: unknown,
  direction: unknown,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (typeof noteId !== "string" || !noteId.trim()) {
      return { ok: false, message: "A valid note ID is required." };
    }
    if (direction !== "forward_to_notion" && direction !== "selective_two_way") {
      return { ok: false, message: "A valid sync direction is required." };
    }
    const result = await updateNotionLinkDirection(
      noteId.trim(),
      direction as NotionSyncDirection,
    );
    if (result.ok) refresh();
    return result;
  } catch (error) {
    return handleActionResult(error);
  }
}
