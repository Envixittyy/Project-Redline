"use server";

import { prepareRoutedInference } from "@/services/integrations/ai/inference-router";
import {
  applyNoteRewrite,
  applyNoteActionItems,
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
  batchId: string,
  noteId: string,
) {
  return applyNoteRewrite(batchId, noteId);
}

export async function applyNoteActionItemsAction(
  batchId: string,
  noteId: string,
) {
  return applyNoteActionItems(batchId, noteId);
}
