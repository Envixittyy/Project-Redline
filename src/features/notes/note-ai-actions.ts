"use server";

import { prepareRoutedInference } from "@/services/integrations/ai/inference-router";
import {
  applyNoteRewriteAction as applyRewriteRepo,
  applyNoteActionItemsAction as applyActionItemsRepo,
} from "@/services/integrations/ai/note-intelligence-repository";

export async function prepareNoteSummaryAction(noteId: string, local: unknown) {
  return prepareRoutedInference("note_summary", noteId, local);
}

export async function prepareNoteRewriteAction(noteId: string, local: unknown) {
  return prepareRoutedInference("note_rewrite", noteId, local);
}

export async function prepareNoteActionItemsAction(noteId: string, local: unknown) {
  return prepareRoutedInference("note_action_items", noteId, local);
}

export async function applyNoteRewriteAction(
  noteId: string,
  rewrittenBody: string,
  mode: "replace" | "append",
) {
  return applyRewriteRepo(noteId, rewrittenBody, mode);
}

export async function applyNoteActionItemsAction(
  noteId: string,
  items: Array<{ title: string; dueDate?: string; priority?: "low" | "medium" | "high" | "urgent" }>,
) {
  return applyActionItemsRepo(noteId, items);
}

