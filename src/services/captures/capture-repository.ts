import "server-only";

import { randomUUID } from "node:crypto";

import type { PostgrestError } from "@supabase/supabase-js";

import {
  captureTextTaskTitle,
  createInboxTextCapture,
  type CaptureInboxItem,
  type CaptureProposal,
  type CaptureStage,
  type RawCapture,
} from "@/features/capture/capture-domain";
import { formatPostgrestErrorDiagnostic } from "@/services/supabase/errors";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";

const CAPTURE_COLUMNS =
  "id,kind,raw_content,stage,interpretation_id,operation_batch_id,error_code,captured_at";

type CaptureRow = {
  id: string;
  kind: "text" | "pasted_text";
  raw_content: { text?: unknown };
  stage: CaptureStage;
  interpretation_id: string | null;
  operation_batch_id: string | null;
  error_code: string | null;
  captured_at: string;
};

type ProposalRow = {
  id: string;
  capture_id: string;
  action_type: "create_task";
  payload: { title?: unknown };
  status: CaptureProposal["status"];
  created_at: string;
};

type BatchRow = { id: string; undo_expires_at: string | null };

export class CaptureRepositoryError extends Error {
  constructor(message: string, readonly detail?: PostgrestError) {
    super(message);
    this.name = "CaptureRepositoryError";
  }
}

function fail(action: string, error: PostgrestError): never {
  console.error(`[captures] ${action} failed: ${formatPostgrestErrorDiagnostic(error)}`);
  throw new CaptureRepositoryError(`Could not ${action}. Please try again.`, error);
}

function toCapture(row: CaptureRow): RawCapture {
  const text = row.raw_content?.text;
  if (typeof text !== "string") {
    throw new CaptureRepositoryError("A capture contains unreadable raw evidence.");
  }

  return {
    id: row.id,
    capturedAt: row.captured_at,
    stage: row.stage,
    content: { kind: row.kind, text },
    interpretationId: row.interpretation_id,
    operationBatchId: row.operation_batch_id,
    errorCode: row.error_code,
  };
}

function toProposal(row: ProposalRow): CaptureProposal {
  const title = row.payload?.title;
  if (typeof title !== "string") {
    throw new CaptureRepositoryError("A capture proposal contains an unreadable title.");
  }
  return {
    id: row.id,
    captureId: row.capture_id,
    action: row.action_type,
    status: row.status,
    title,
    createdAt: row.created_at,
  };
}

export async function createTextCapture(text: string): Promise<RawCapture> {
  const capture = createInboxTextCapture(randomUUID(), text, new Date().toISOString());
  if (capture.content.kind !== "text") {
    throw new CaptureRepositoryError("Text capture produced an unexpected raw kind.");
  }
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client
    .from("captures")
    .insert({
      id: capture.id,
      user_id: userId,
      kind: capture.content.kind,
      raw_content: { text: capture.content.text },
      stage: capture.stage,
      captured_at: capture.capturedAt,
    })
    .select(CAPTURE_COLUMNS)
    .single();

  if (error) fail("save the capture", error);
  return toCapture(data as CaptureRow);
}

export async function listCaptureInbox(): Promise<CaptureInboxItem[]> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const captureResult = await client
    .from("captures")
    .select(CAPTURE_COLUMNS)
    .eq("user_id", userId)
    .in("kind", ["text", "pasted_text"])
    .order("captured_at", { ascending: false })
    .limit(200);

  if (captureResult.error) fail("load the capture inbox", captureResult.error);
  const rows = captureResult.data as CaptureRow[];
  if (!rows.length) return [];

  const captureIds = rows.map((row) => row.id);
  const batchIds = rows.flatMap((row) =>
    row.operation_batch_id ? [row.operation_batch_id] : [],
  );
  const [proposalResult, batchResult] = await Promise.all([
    client
      .from("capture_proposals")
      .select("id,capture_id,action_type,payload,status,created_at")
      .eq("user_id", userId)
      .in("capture_id", captureIds)
      .order("created_at", { ascending: false }),
    batchIds.length
      ? client
          .from("operation_batches")
          .select("id,undo_expires_at")
          .eq("user_id", userId)
          .in("id", batchIds)
      : Promise.resolve({ data: [] as BatchRow[], error: null }),
  ]);

  if (proposalResult.error) fail("load capture proposals", proposalResult.error);
  if (batchResult.error) fail("load capture undo windows", batchResult.error);

  const proposals = new Map<string, CaptureProposal>();
  for (const row of proposalResult.data as ProposalRow[]) {
    if (!proposals.has(row.capture_id)) proposals.set(row.capture_id, toProposal(row));
  }
  const batches = new Map(
    (batchResult.data as BatchRow[]).map((row) => [row.id, row.undo_expires_at]),
  );

  return rows.map((row) => {
    const capture = toCapture(row);
    return {
      ...capture,
      proposal: proposals.get(capture.id) ?? null,
      undoExpiresAt: capture.operationBatchId
        ? (batches.get(capture.operationBatchId) ?? null)
        : null,
    };
  });
}

export async function prepareCaptureTask(captureId: string): Promise<CaptureProposal> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const captureResult = await client
    .from("captures")
    .select(CAPTURE_COLUMNS)
    .eq("id", captureId)
    .eq("user_id", userId)
    .maybeSingle();
  if (captureResult.error) fail("load the capture", captureResult.error);
  if (!captureResult.data) throw new CaptureRepositoryError("That capture no longer exists.");

  const capture = toCapture(captureResult.data as CaptureRow);
  const title = captureTextTaskTitle(capture);
  const { data, error } = await client.rpc("prepare_capture_task", {
    target_capture_id: capture.id,
    proposed_title: title,
  });
  if (error) fail("prepare the task proposal", error);

  const result = (data as Array<{ proposal_id: string; title: string }> | null)?.[0];
  if (!result) throw new CaptureRepositoryError("The task proposal was not returned.");
  return {
    id: result.proposal_id,
    captureId: capture.id,
    action: "create_task",
    status: "proposed",
    title: result.title,
    createdAt: new Date().toISOString(),
  };
}

export async function commitCaptureTask(
  captureId: string,
  proposalId: string,
  title: string,
): Promise<void> {
  const { client } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc("commit_capture_task", {
    target_capture_id: captureId,
    target_proposal_id: proposalId,
    task_title: title,
  });
  if (error) fail("commit the capture task", error);
}

export async function undoCaptureTask(captureId: string): Promise<void> {
  const { client } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc("undo_capture_task", {
    target_capture_id: captureId,
  });
  if (error) fail("undo the capture task", error);
}
