import type { AiContextEnvelope, AiContextItem, AiSourceReference } from "./types";

export const MAX_SOURCES = 10;
export const MAX_PROMPT_LENGTH = 4000;
export const MAX_ITEM_TEXT_LENGTH = 10000;
export const MAX_TOTAL_PAYLOAD_BYTES = 64 * 1024; // 64 KB

export type RawTaskContext = {
  id: string;
  title: string;
  description?: string | null;
  dueAt?: string | null;
  priority?: string | null;
  updatedAt?: string;
};

export type RawNoteContext = {
  id: string;
  title: string;
  body?: string | null;
  updatedAt?: string;
};

export type RawEventContext = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  updatedAt?: string;
};

export type RawCaptureContext = {
  id: string;
  rawText: string;
  capturedAt?: string;
};

export type RawContextInput = {
  purpose: string;
  prompt?: string;
  tasks?: RawTaskContext[];
  notes?: RawNoteContext[];
  events?: RawEventContext[];
  captures?: RawCaptureContext[];
  locale?: string;
  timeZone?: string;
};

export type ContextMinimizationResult = {
  envelope: AiContextEnvelope;
  sourceReferences: AiSourceReference[];
  handleMap: Record<string, { entityType: "task" | "note" | "capture" | "event" | "schedule"; entityId: string }>;
  allowListedFields: string[];
  totalByteCount: number;
};

function normalizeText(text: string | null | undefined, maxLength: number): string | undefined {
  if (typeof text !== "string") return undefined;
  const normalized = text.normalize("NFC").replace(/\r\n/g, "\n").trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

/**
 * Minimizes raw domain entities into a bounded, request-bound context envelope.
 * Excludes internal IDs, auth tokens, database metadata, and RLS structures.
 */
export function minimizeContext(input: RawContextInput): ContextMinimizationResult {
  const items: AiContextItem[] = [];
  const sourceReferences: AiSourceReference[] = [];
  const handleMap: Record<string, { entityType: "task" | "note" | "capture" | "event" | "schedule"; entityId: string }> = {};
  const allowListedFieldsSet = new Set<string>();

  let sourceIndex = 1;

  // Process Tasks
  if (input.tasks) {
    for (const task of input.tasks.slice(0, MAX_SOURCES)) {
      const handle = `task_${sourceIndex++}`;
      const title = normalizeText(task.title, 200) || "Untitled Task";
      const description = normalizeText(task.description, MAX_ITEM_TEXT_LENGTH);
      const dueAt = task.dueAt || undefined;
      const priority = task.priority || undefined;

      allowListedFieldsSet.add("title");
      if (description) allowListedFieldsSet.add("description");
      if (dueAt) allowListedFieldsSet.add("dueAt");
      if (priority) allowListedFieldsSet.add("priority");

      items.push({
        handle,
        entityType: "task",
        title,
        description,
        dueAt,
        priority,
      });

      sourceReferences.push({
        entityType: "task",
        entityId: task.id,
        revision: task.updatedAt || new Date().toISOString(),
        label: `Task: ${title}`,
      });

      handleMap[handle] = { entityType: "task", entityId: task.id };
    }
  }

  // Process Notes
  if (input.notes) {
    for (const note of input.notes.slice(0, MAX_SOURCES - items.length)) {
      const handle = `note_${sourceIndex++}`;
      const title = normalizeText(note.title, 200) || "Untitled Note";
      const body = normalizeText(note.body, MAX_ITEM_TEXT_LENGTH);

      allowListedFieldsSet.add("title");
      if (body) allowListedFieldsSet.add("body");

      items.push({
        handle,
        entityType: "note",
        title,
        body,
      });

      sourceReferences.push({
        entityType: "note",
        entityId: note.id,
        revision: note.updatedAt || new Date().toISOString(),
        label: `Note: ${title}`,
      });

      handleMap[handle] = { entityType: "note", entityId: note.id };
    }
  }

  // Process Events
  if (input.events) {
    for (const event of input.events.slice(0, MAX_SOURCES - items.length)) {
      const handle = `event_${sourceIndex++}`;
      const title = normalizeText(event.title, 200) || "Untitled Event";
      const startsAt = event.startsAt;
      const endsAt = event.endsAt;

      allowListedFieldsSet.add("title");
      allowListedFieldsSet.add("startsAt");
      allowListedFieldsSet.add("endsAt");

      items.push({
        handle,
        entityType: "event",
        title,
        startsAt,
        endsAt,
      });

      sourceReferences.push({
        entityType: "event",
        entityId: event.id,
        revision: event.updatedAt || new Date().toISOString(),
        label: `Event: ${title}`,
      });

      handleMap[handle] = { entityType: "event", entityId: event.id };
    }
  }

  // Process Captures
  if (input.captures) {
    for (const capture of input.captures.slice(0, MAX_SOURCES - items.length)) {
      const handle = `capture_${sourceIndex++}`;
      const text = normalizeText(capture.rawText, MAX_ITEM_TEXT_LENGTH) || "";

      allowListedFieldsSet.add("rawText");

      items.push({
        handle,
        entityType: "capture",
        body: text,
      });

      sourceReferences.push({
        entityType: "capture",
        entityId: capture.id,
        revision: capture.capturedAt || new Date().toISOString(),
        label: `Capture: ${text.slice(0, 30)}...`,
      });

      handleMap[handle] = { entityType: "capture", entityId: capture.id };
    }
  }

  const normalizedPrompt = normalizeText(input.prompt, MAX_PROMPT_LENGTH);
  if (normalizedPrompt) {
    allowListedFieldsSet.add("prompt");
  }

  const envelope: AiContextEnvelope = {
    version: 1,
    purpose: input.purpose.trim(),
    prompt: normalizedPrompt,
    items,
    locale: input.locale || "en-US",
    timeZone: input.timeZone || "UTC",
  };

  const jsonStr = JSON.stringify(envelope);
  const totalByteCount = Buffer.byteLength(jsonStr, "utf8");

  if (totalByteCount > MAX_TOTAL_PAYLOAD_BYTES) {
    throw new Error(`Total AI payload exceeds limit of ${MAX_TOTAL_PAYLOAD_BYTES} bytes.`);
  }

  return {
    envelope,
    sourceReferences,
    handleMap,
    allowListedFields: Array.from(allowListedFieldsSet).sort(),
    totalByteCount,
  };
}
