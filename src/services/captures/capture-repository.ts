import "server-only";

import { randomUUID } from "node:crypto";

import type { PostgrestError } from "@supabase/supabase-js";

import {
  captureTextTaskTitle,
  createInboxTextCapture,
  type CaptureInboxItem,
  type CaptureProposal,
  type CaptureStage,
  type ExternalProposalMetadata,
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
  external_record_id: string | null;
  action_type: "create_task";
  payload: {
    title?: unknown;
    description?: unknown;
    dueDate?: unknown;
    dueAt?: unknown;
    duePrecision?: unknown;
    courseId?: unknown;
  };
  source_revision: string | null;
  reviewed_source_revision: string | null;
  source_snapshot: Record<string, unknown> | null;
  status: CaptureProposal["status"];
  created_at: string;
  updated_at: string;
};

type ExternalRecordRow = {
  id: string;
  external_uid: string;
  source_url: string | null;
  course_code: string | null;
  course_id: string | null;
  due_at: string | null;
  due_date: string | null;
  due_precision: "none" | "date" | "instant" | "unresolved";
  normalized_description: string | null;
  proposal_revision: string | null;
  missing_since: string | null;
};

type CourseRow = {
  id: string;
  code: string;
  name: string;
  color: string;
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

function toProposal(
  row: ProposalRow,
  extRecordMap?: Map<string, ExternalRecordRow>,
  courseMap?: Map<string, CourseRow>,
): CaptureProposal {
  const title = row.payload?.title;
  if (typeof title !== "string") {
    throw new CaptureRepositoryError("A capture proposal contains an unreadable title.");
  }

  const description = typeof row.payload?.description === "string" ? row.payload.description : null;
  const dueDate = typeof row.payload?.dueDate === "string" ? row.payload.dueDate : null;
  const dueAt = typeof row.payload?.dueAt === "string" ? row.payload.dueAt : null;
  const duePrecision =
    typeof row.payload?.duePrecision === "string"
      ? (row.payload.duePrecision as "none" | "date" | "instant" | "unresolved")
      : "none";
  const courseId = typeof row.payload?.courseId === "string" ? row.payload.courseId : null;

  let external: ExternalProposalMetadata | null = null;
  if (row.external_record_id && extRecordMap) {
    const ext = extRecordMap.get(row.external_record_id);
    if (ext) {
      const course = ext.course_id && courseMap ? courseMap.get(ext.course_id) : null;
      external = {
        provider: "blackboard",
        externalRecordId: ext.id,
        sourceUid: ext.external_uid,
        sourceUrl: ext.source_url,
        courseCode: ext.course_code,
        courseId: ext.course_id,
        courseName: course?.name ?? null,
        courseColor: course?.color ?? null,
        dueDate: ext.due_date,
        dueAt: ext.due_at,
        duePrecision: ext.due_precision,
        description: ext.normalized_description,
        sourceRevision: row.source_revision,
        reviewedSourceRevision: row.reviewed_source_revision,
        isDivergent:
          row.status === "committed" &&
          row.source_revision !== null &&
          row.source_revision !== row.reviewed_source_revision,
        isMissing: ext.missing_since !== null,
      };
    }
  }

  return {
    id: row.id,
    captureId: row.capture_id,
    action: row.action_type,
    status: row.status,
    title,
    description,
    dueDate,
    dueAt,
    duePrecision,
    courseId,
    external,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
      .select("id,capture_id,external_record_id,action_type,payload,source_revision,reviewed_source_revision,source_snapshot,status,created_at,updated_at")
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

  const proposalRows = (proposalResult.data ?? []) as ProposalRow[];
  const externalRecordIds = proposalRows
    .map((p) => p.external_record_id)
    .filter((id): id is string => Boolean(id));

  let extRecordMap = new Map<string, ExternalRecordRow>();
  let courseMap = new Map<string, CourseRow>();

  if (externalRecordIds.length > 0) {
    const [extResult, courseResult] = await Promise.all([
      client
        .from("external_records")
        .select("id,external_uid,source_url,course_code,course_id,due_at,due_date,due_precision,normalized_description,proposal_revision,missing_since")
        .eq("user_id", userId)
        .in("id", externalRecordIds),
      client
        .from("courses")
        .select("id,code,name,color")
        .eq("user_id", userId),
    ]);

    if (extResult.error) fail("load external record metadata", extResult.error);
    if (courseResult.error) fail("load courses", courseResult.error);

    extRecordMap = new Map((extResult.data as ExternalRecordRow[]).map((r) => [r.id, r]));
    courseMap = new Map((courseResult.data as CourseRow[]).map((c) => [c.id, c]));
  }

  const proposals = new Map<string, CaptureProposal>();
  for (const row of proposalRows) {
    if (!proposals.has(row.capture_id)) {
      proposals.set(row.capture_id, toProposal(row, extRecordMap, courseMap));
    }
  }

  const batches = new Map(
    (batchResult.data as BatchRow[]).map((row) => [row.id, row.undo_expires_at]),
  );

  return rows
    .map((row) => {
      const capture = toCapture(row);
      const proposal = proposals.get(capture.id) ?? null;
      return {
        ...capture,
        proposal,
        undoExpiresAt: capture.operationBatchId
          ? (batches.get(capture.operationBatchId) ?? null)
          : null,
      };
    })
    .filter((item) => {
      // Hide dismissed proposals from the active Inbox view unless reopening
      if (item.proposal && item.proposal.status === "rejected") {
        return false;
      }
      return true;
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
  description?: string | null,
  dueDate?: string | null,
  dueAt?: string | null,
  courseId?: string | null,
): Promise<void> {
  const { client } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc("commit_capture_task", {
    target_capture_id: captureId,
    target_proposal_id: proposalId,
    task_title: title,
    task_description: description ?? null,
    task_due_date: dueDate ?? null,
    task_due_at: dueAt ?? null,
    task_course_id: courseId ?? null,
  });
  if (error) fail("commit the capture task", error);
}

export async function dismissCaptureProposal(proposalId: string): Promise<void> {
  const { client } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc("dismiss_capture_proposal", {
    target_proposal_id: proposalId,
  });
  if (error) fail("dismiss the capture proposal", error);
}

export async function acknowledgeProposalDivergence(proposalId: string): Promise<void> {
  const { client } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc("acknowledge_proposal_divergence", {
    target_proposal_id: proposalId,
  });
  if (error) fail("acknowledge the proposal change", error);
}

export async function undoCaptureTask(captureId: string): Promise<void> {
  const { client } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc("undo_capture_task", {
    target_capture_id: captureId,
  });
  if (error) fail("undo the capture task", error);
}
