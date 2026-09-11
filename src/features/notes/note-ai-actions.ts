"use server";
import { revalidatePath } from "next/cache";
import { prepareRoutedInference } from "@/services/integrations/ai/inference-router";
import {
  applyNoteSummary,
  applyNoteRewrite,
  applyNoteActionItems,
  reviseNoteIntelligence,
  type NoteKind,
} from "@/services/integrations/ai/note-intelligence-repository";
import { readNote } from "@/services/notes/note-repository";
export async function prepareNoteSummaryAction(id: string, local: unknown) {
  return prepareRoutedInference("note_summary", id, local);
}
export async function prepareNoteRewriteAction(id: string, local: unknown) {
  return prepareRoutedInference("note_rewrite", id, local);
}
export async function prepareNoteActionItemsAction(id: string, local: unknown) {
  return prepareRoutedInference("note_action_items", id, local);
}
export async function reviseNoteAction(
  id: string,
  kind: NoteKind,
  proposal: unknown,
) {
  return reviseNoteIntelligence(id, kind, proposal);
}
export async function applyNoteSummaryAction(id: string) {
  const r = await applyNoteSummary(id);
  revalidatePath("/notes");
  const note = await readNote(r.noteId!);
  return { ok: true as const, note, newBody: note.body };
}
export async function applyNoteRewriteAction(id: string, _noteId?: string) {
  const r = await applyNoteRewrite(id);
  revalidatePath("/notes");
  const note = await readNote(r.noteId!);
  return { ok: true as const, note, newBody: note.body };
}
export async function applyNoteActionItemsAction(id: string, _noteId?: string) {
  const r = await applyNoteActionItems(id);
  for (const p of ["/tasks", "/calendar", "/", "/notes"]) revalidatePath(p);
  return r;
}
