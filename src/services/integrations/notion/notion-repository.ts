import "server-only";

import { randomUUID } from "node:crypto";

import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { formatPostgrestErrorDiagnostic } from "@/services/supabase/errors";
import { decryptCredential, encryptCredential } from "@/services/integrations/credential";

import {
  buildManagedRootMarker,
  canonicalAstToMarkdown,
  canonicalAstToNotionBlocks,
  computeCanonicalFingerprint,
  CONVERTER_VERSION,
  markdownToCanonicalAst,
  notionBlocksToCanonicalAst,
} from "./canonical-ast";
import {
  appendStagedRoot,
  archiveNotionBlock,
  createPageWithManagedRoot,
  fetchManagedRoot,
  NotionClientError,
  validateNotionToken,
} from "./notion-client";
import { planNotionSyncTransition } from "./sync-planner";
import type {
  CanonicalDocument,
  NotionAccountStatus,
  NotionConflictResolution,
  NotionPageLink,
  NotionPageLinkStatus,
  NotionSyncConflict,
  NotionSyncDirection,
} from "./types";

type AuthenticatedClient = Awaited<
  ReturnType<typeof requireAuthenticatedSupabase>
>["client"];

export class NotionRepositoryError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "NotionRepositoryError";
  }
}

type LinkRow = {
  id: string;
  user_id: string;
  account_id: string;
  note_id: string;
  workspace_id: string;
  remote_page_id: string;
  remote_root_block_id: string | null;
  remote_url: string;
  direction: NotionSyncDirection;
  converter_version: number;
  base_snapshot: CanonicalDocument | null;
  base_local_fingerprint: string | null;
  base_remote_fingerprint: string | null;
  last_observed_local_fingerprint: string | null;
  last_observed_remote_fingerprint: string | null;
  last_pushed_fingerprint: string | null;
  last_remote_revision: string | null;
  active_attempt_id: string | null;
  pending_attempt_id: string | null;
  pending_root_block_id: string | null;
  status: NotionPageLinkStatus;
  last_error_code: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
};

type ConflictRow = {
  id: string;
  user_id: string;
  link_id: string;
  base_snapshot: CanonicalDocument;
  local_snapshot: CanonicalDocument;
  remote_snapshot: CanonicalDocument;
  base_fingerprint: string;
  local_fingerprint: string;
  remote_fingerprint: string;
  remote_revision: string;
  status: "open" | "resolved";
  resolution: NotionConflictResolution | null;
  resolved_fingerprint: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

function toNotionPageLink(row: LinkRow): NotionPageLink {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    noteId: row.note_id,
    workspaceId: row.workspace_id,
    remotePageId: row.remote_page_id,
    remoteRootBlockId: row.remote_root_block_id,
    remoteUrl: row.remote_url,
    direction: row.direction,
    converterVersion: row.converter_version,
    baseSnapshot: row.base_snapshot,
    baseLocalFingerprint: row.base_local_fingerprint,
    baseRemoteFingerprint: row.base_remote_fingerprint,
    lastObservedLocalFingerprint: row.last_observed_local_fingerprint,
    lastObservedRemoteFingerprint: row.last_observed_remote_fingerprint,
    lastPushedFingerprint: row.last_pushed_fingerprint,
    lastRemoteRevision: row.last_remote_revision,
    activeAttemptId: row.active_attempt_id,
    pendingAttemptId: row.pending_attempt_id,
    pendingRootBlockId: row.pending_root_block_id,
    status: row.status,
    lastErrorCode: row.last_error_code,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    retiredAt: row.retired_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toNotionSyncConflict(row: ConflictRow): NotionSyncConflict {
  return {
    id: row.id,
    userId: row.user_id,
    linkId: row.link_id,
    baseSnapshot: row.base_snapshot,
    localSnapshot: row.local_snapshot,
    remoteSnapshot: row.remote_snapshot,
    baseFingerprint: row.base_fingerprint,
    localFingerprint: row.local_fingerprint,
    remoteFingerprint: row.remote_fingerprint,
    remoteRevision: row.remote_revision,
    status: row.status,
    resolution: row.resolution,
    resolvedFingerprint: row.resolved_fingerprint,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Returns the user's current Notion integration account status and active link count. */
export async function getNotionAccountStatus(): Promise<NotionAccountStatus> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const accountRes = await client
    .from("integration_accounts")
    .select("id,status,credential_hint,sync_state,last_success_at,last_error_code")
    .eq("user_id", userId)
    .eq("provider", "notion")
    .maybeSingle();

  if (accountRes.error) {
    console.error("[notion] error fetching account:", formatPostgrestErrorDiagnostic(accountRes.error));
    throw new NotionRepositoryError("Could not retrieve Notion account status.");
  }

  const account = accountRes.data;
  if (!account) {
    return {
      connected: false,
      accountId: null,
      credentialHint: null,
      syncState: "idle",
      lastSuccessAt: null,
      lastErrorCode: null,
      activeLinksCount: 0,
      conflictsCount: 0,
    };
  }

  const [linksCountRes, conflictsCountRes] = await Promise.all([
    client
      .from("notion_page_links")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("retired_at", null),
    client
      .from("notion_sync_conflicts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "open"),
  ]);

  return {
    connected: account.status === "connected",
    accountId: account.id,
    credentialHint: account.credential_hint,
    syncState: account.sync_state,
    lastSuccessAt: account.last_success_at,
    lastErrorCode: account.last_error_code,
    activeLinksCount: linksCountRes.count ?? 0,
    conflictsCount: conflictsCountRes.count ?? 0,
  };
}

/** Connects or updates a Notion integration token. */
export async function connectNotionAccount(
  token: string,
  credentialHint?: string,
): Promise<{ ok: boolean; message: string }> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    return { ok: false, message: "A Notion integration token is required." };
  }

  try {
    const tokenInfo = await validateNotionToken(trimmedToken);
    const hint = credentialHint?.trim() || tokenInfo.workspaceName || "Notion Workspace";
    const encrypted = encryptCredential(trimmedToken);

    const { error } = await client.from("integration_accounts").upsert(
      {
        user_id: userId,
        provider: "notion",
        status: "connected",
        encrypted_credential: encrypted,
        credential_hint: hint,
        sync_state: "idle",
        last_error_code: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    );

    if (error) {
      console.error("[notion] failed to save connection:", formatPostgrestErrorDiagnostic(error));
      return { ok: false, message: "Could not save Notion credentials." };
    }

    return { ok: true, message: `Connected to ${hint}.` };
  } catch (err) {
    console.error("[notion] connection validation error:", err);
    if (err instanceof NotionClientError) {
      return { ok: false, message: err.message };
    }
    return { ok: false, message: "Failed to validate Notion token." };
  }
}

/** Disconnects Notion without deleting linked notes or remote content. */
export async function disconnectNotionAccount(): Promise<{ ok: boolean; message: string }> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const { error } = await client
    .from("integration_accounts")
    .update({
      status: "disconnected",
      sync_state: "idle",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", "notion");

  if (error) {
    console.error("[notion] disconnect error:", formatPostgrestErrorDiagnostic(error));
    return { ok: false, message: "Could not disconnect Notion." };
  }

  // Mark active links disconnected
  await client
    .from("notion_page_links")
    .update({ status: "disconnected" })
    .eq("user_id", userId)
    .is("retired_at", null);

  return { ok: true, message: "Notion account disconnected." };
}

/** Lists all active Notion page links for the authenticated user. */
export async function listNotionPageLinks(): Promise<NotionPageLink[]> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const { data, error } = await client
    .from("notion_page_links")
    .select("*")
    .eq("user_id", userId)
    .is("retired_at", null)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[notion] list links error:", formatPostgrestErrorDiagnostic(error));
    throw new NotionRepositoryError("Could not retrieve Notion page links.");
  }

  return (data as LinkRow[]).map(toNotionPageLink);
}

/** Retrieves the active Notion page link for a given note. */
export async function getNotionPageLinkForNote(noteId: string): Promise<NotionPageLink | null> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const { data, error } = await client
    .from("notion_page_links")
    .select("*")
    .eq("user_id", userId)
    .eq("note_id", noteId)
    .is("retired_at", null)
    .maybeSingle();

  if (error) {
    console.error("[notion] get link for note error:", formatPostgrestErrorDiagnostic(error));
    throw new NotionRepositoryError("Could not retrieve Notion link for this note.");
  }

  return data ? toNotionPageLink(data as LinkRow) : null;
}

/** Retrieves open conflict for a link. */
export async function getNotionSyncConflict(linkId: string): Promise<NotionSyncConflict | null> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const { data, error } = await client
    .from("notion_sync_conflicts")
    .select("*")
    .eq("user_id", userId)
    .eq("link_id", linkId)
    .eq("status", "open")
    .maybeSingle();

  if (error) {
    console.error("[notion] get conflict error:", formatPostgrestErrorDiagnostic(error));
    throw new NotionRepositoryError("Could not retrieve conflict details.");
  }

  return data ? toNotionSyncConflict(data as ConflictRow) : null;
}

async function getDecryptedNotionToken(
  userId: string,
  client: AuthenticatedClient,
): Promise<{ token: string; accountId: string }> {
  const { data, error } = await client
    .from("integration_accounts")
    .select("id,status,encrypted_credential")
    .eq("user_id", userId)
    .eq("provider", "notion")
    .maybeSingle();

  if (error || !data) {
    throw new NotionRepositoryError("Notion is not connected.", "not_connected");
  }
  if (data.status !== "connected") {
    throw new NotionRepositoryError("Notion account is disconnected.", "disconnected");
  }

  const token = decryptCredential(data.encrypted_credential);
  return { token, accountId: data.id };
}

/** Exports a Redline note to a new Notion page and establishes a link. */
export async function exportNoteToNotion(
  noteId: string,
  parentPageId: string,
  direction: NotionSyncDirection = "forward_to_notion",
): Promise<{ ok: boolean; message: string; link?: NotionPageLink }> {
  const { client, userId } = await requireAuthenticatedSupabase();

  // 1. Fetch note
  const { data: note, error: noteErr } = await client
    .from("notes")
    .select("id,title,body,archived_at")
    .eq("id", noteId)
    .eq("user_id", userId)
    .maybeSingle();

  if (noteErr || !note) {
    return { ok: false, message: "Note does not exist." };
  }

  // 2. Check if already linked
  const existingLink = await getNotionPageLinkForNote(noteId);
  if (existingLink) {
    return { ok: false, message: "This note is already linked to a Notion page." };
  }

  // 3. Get decrypted token
  const { token, accountId } = await getDecryptedNotionToken(userId, client);

  // 4. Validate and build AST
  let doc: CanonicalDocument;
  try {
    doc = markdownToCanonicalAst(note.title, note.body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unsupported Markdown content.";
    return { ok: false, message: `Cannot export note: ${msg}` };
  }

  const localFingerprint = computeCanonicalFingerprint(doc);
  const attemptId = randomUUID();
  const linkId = randomUUID();
  const marker = buildManagedRootMarker(linkId, CONVERTER_VERSION, attemptId);
  const notionBlocks = canonicalAstToNotionBlocks(doc);

  // 5. Create remote page
  let created: { pageId: string; pageUrl: string; rootBlockId: string };
  try {
    created = await createPageWithManagedRoot(
      token,
      parentPageId.trim(),
      note.title,
      marker,
      notionBlocks,
    );
  } catch (err) {
    console.error("[notion] create page failed:", err);
    const msg = err instanceof Error ? err.message : "Notion page creation failed.";
    return { ok: false, message: msg };
  }

  // 6. Persist link row
  const now = new Date().toISOString();
  const { data: linkData, error: insertErr } = await client
    .from("notion_page_links")
    .insert({
      id: linkId,
      user_id: userId,
      account_id: accountId,
      note_id: noteId,
      workspace_id: accountId,
      remote_page_id: created.pageId,
      remote_root_block_id: created.rootBlockId,
      remote_url: created.pageUrl,
      direction,
      converter_version: CONVERTER_VERSION,
      base_snapshot: doc,
      base_local_fingerprint: localFingerprint,
      base_remote_fingerprint: localFingerprint,
      last_observed_local_fingerprint: localFingerprint,
      last_observed_remote_fingerprint: localFingerprint,
      last_pushed_fingerprint: localFingerprint,
      last_remote_revision: now,
      status: "synced",
      last_attempt_at: now,
      last_success_at: now,
    })
    .select("*")
    .single();

  if (insertErr) {
    console.error("[notion] insert link error:", formatPostgrestErrorDiagnostic(insertErr));
    return { ok: false, message: "Created Notion page but failed to save link." };
  }

  return {
    ok: true,
    message: "Note successfully exported to Notion.",
    link: toNotionPageLink(linkData as LinkRow),
  };
}

/** Synchronizes a single note with its linked Notion page. */
export async function syncNoteWithNotion(
  noteId: string,
): Promise<{ ok: boolean; message: string; actionTaken?: string }> {
  const { client, userId } = await requireAuthenticatedSupabase();

  // 1. Get link and note
  const link = await getNotionPageLinkForNote(noteId);
  if (!link) {
    return { ok: false, message: "Note is not linked to Notion." };
  }

  const { data: note, error: noteErr } = await client
    .from("notes")
    .select("id,title,body,archived_at")
    .eq("id", noteId)
    .eq("user_id", userId)
    .maybeSingle();

  if (noteErr || !note) {
    return { ok: false, message: "Note not found." };
  }

  if (note.archived_at) {
    await client
      .from("notion_page_links")
      .update({ status: "local_archived" })
      .eq("id", link.id);
    return { ok: true, message: "Note is archived locally; sync paused.", actionTaken: "local_archived" };
  }

  // 2. Token
  const { token } = await getDecryptedNotionToken(userId, client);

  // 3. Mark link syncing
  const attemptId = randomUUID();
  await client
    .from("notion_page_links")
    .update({
      status: "syncing",
      active_attempt_id: attemptId,
      last_attempt_at: new Date().toISOString(),
    })
    .eq("id", link.id);

  // 4. Compute local AST & fingerprint
  let localDoc: CanonicalDocument;
  try {
    localDoc = markdownToCanonicalAst(note.title, note.body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unsupported local markdown.";
    await client
      .from("notion_page_links")
      .update({ status: "unsupported", last_error_code: msg })
      .eq("id", link.id);
    return { ok: false, message: `Local content unsupported: ${msg}` };
  }
  const currentLocalFingerprint = computeCanonicalFingerprint(localDoc);

  // 5. Fetch remote managed root
  if (!link.remoteRootBlockId) {
    await client
      .from("notion_page_links")
      .update({ status: "remote_structure_changed" })
      .eq("id", link.id);
    return { ok: false, message: "Managed root pointer is missing." };
  }

  const remoteResult = await fetchManagedRoot(token, link.remoteRootBlockId);
  if (!remoteResult.ok) {
    if (remoteResult.error === "not_found") {
      await client
        .from("notion_page_links")
        .update({ status: "remote_missing" })
        .eq("id", link.id);
      return { ok: false, message: "Linked Notion page/block was deleted or trashed." };
    }
    await client
      .from("notion_page_links")
      .update({ status: "error", last_error_code: remoteResult.error })
      .eq("id", link.id);
    return { ok: false, message: "Could not fetch remote Notion content." };
  }

  // 6. Convert remote blocks to Canonical AST
  const remoteAstResult = notionBlocksToCanonicalAst(remoteResult.children);
  if (!remoteAstResult.ok) {
    await client
      .from("notion_page_links")
      .update({ status: "unsupported", last_error_code: remoteAstResult.reason })
      .eq("id", link.id);
    return { ok: false, message: `Remote content unsupported: ${remoteAstResult.reason}` };
  }

  const remoteDoc = remoteAstResult.doc;
  const currentRemoteFingerprint = computeCanonicalFingerprint(remoteDoc);

  // 7. Plan Transition
  const decision = planNotionSyncTransition({
    direction: link.direction,
    currentLocalFingerprint,
    currentRemoteFingerprint,
    baseLocalFingerprint: link.baseLocalFingerprint,
    baseRemoteFingerprint: link.baseRemoteFingerprint,
    lastPushedFingerprint: link.lastPushedFingerprint,
    converterVersion: link.converterVersion,
    currentConverterVersion: CONVERTER_VERSION,
    currentStatus: link.status,
  });

  const now = new Date().toISOString();

  // 8. Execute Decision
  switch (decision.action) {
    case "no_op": {
      await client
        .from("notion_page_links")
        .update({
          status: "synced",
          last_observed_local_fingerprint: currentLocalFingerprint,
          last_observed_remote_fingerprint: currentRemoteFingerprint,
          last_remote_revision: remoteResult.lastEditedTime,
          last_error_code: null,
          last_success_at: now,
        })
        .eq("id", link.id);
      return { ok: true, message: "Already in sync.", actionTaken: "no_op" };
    }

    case "push_to_remote": {
      // Stage new generation root
      const marker = buildManagedRootMarker(link.id, CONVERTER_VERSION, attemptId);
      const blocks = canonicalAstToNotionBlocks(localDoc);

      const staged = await appendStagedRoot(token, link.remotePageId, marker, blocks);

      // Verify staged root
      const verifyStaged = await fetchManagedRoot(token, staged.rootBlockId);
      if (!verifyStaged.ok) {
        await archiveNotionBlock(token, staged.rootBlockId);
        await client
          .from("notion_page_links")
          .update({ status: "error", last_error_code: "staged_root_verification_failed" })
          .eq("id", link.id);
        return { ok: false, message: "Failed to verify staged Notion content." };
      }

      const stagedAst = notionBlocksToCanonicalAst(verifyStaged.children);
      if (!stagedAst.ok || computeCanonicalFingerprint(stagedAst.doc) !== currentLocalFingerprint) {
        await archiveNotionBlock(token, staged.rootBlockId);
        await client
          .from("notion_page_links")
          .update({ status: "error", last_error_code: "staged_fingerprint_mismatch" })
          .eq("id", link.id);
        return { ok: false, message: "Staged content fingerprint did not match local note." };
      }

      // Atomic swap of remote_root_block_id
      const oldRootId = link.remoteRootBlockId;
      await client
        .from("notion_page_links")
        .update({
          remote_root_block_id: staged.rootBlockId,
          base_snapshot: localDoc,
          base_local_fingerprint: currentLocalFingerprint,
          base_remote_fingerprint: currentLocalFingerprint,
          last_observed_local_fingerprint: currentLocalFingerprint,
          last_observed_remote_fingerprint: currentLocalFingerprint,
          last_pushed_fingerprint: currentLocalFingerprint,
          last_remote_revision: verifyStaged.lastEditedTime,
          status: "synced",
          last_error_code: null,
          last_success_at: now,
        })
        .eq("id", link.id);

      // Archive old root
      if (oldRootId) {
        await archiveNotionBlock(token, oldRootId);
      }

      return { ok: true, message: "Pushed changes to Notion.", actionTaken: "pushed" };
    }

    case "import_to_local": {
      const { markdown: newBody } = canonicalAstToMarkdown(remoteDoc);

      const rpcRes = await client.rpc("notion_apply_remote_import", {
        p_link_id: link.id,
        p_title: remoteDoc.title,
        p_body: newBody,
        p_base_snapshot: remoteDoc,
        p_local_fp: currentRemoteFingerprint,
        p_remote_fp: currentRemoteFingerprint,
        p_remote_revision: remoteResult.lastEditedTime,
      });

      if (rpcRes.error) {
        console.error("[notion] apply remote import RPC error:", formatPostgrestErrorDiagnostic(rpcRes.error));
        return { ok: false, message: "Failed to apply remote changes to note." };
      }

      return { ok: true, message: "Imported remote changes from Notion.", actionTaken: "imported" };
    }

    case "mark_remote_pending": {
      await client
        .from("notion_page_links")
        .update({
          status: "remote_pending",
          last_observed_remote_fingerprint: currentRemoteFingerprint,
          last_remote_revision: remoteResult.lastEditedTime,
        })
        .eq("id", link.id);
      return { ok: true, message: "Remote changes detected and ready for review.", actionTaken: "remote_pending" };
    }

    case "create_conflict": {
      const { error: conflictErr } = await client
        .from("notion_sync_conflicts")
        .upsert(
          {
            user_id: userId,
            link_id: link.id,
            base_snapshot: link.baseSnapshot ?? localDoc,
            local_snapshot: localDoc,
            remote_snapshot: remoteDoc,
            base_fingerprint: link.baseLocalFingerprint ?? currentLocalFingerprint,
            local_fingerprint: currentLocalFingerprint,
            remote_fingerprint: currentRemoteFingerprint,
            remote_revision: remoteResult.lastEditedTime,
            status: "open",
            updated_at: now,
          },
          { onConflict: "link_id" },
        );

      if (conflictErr) {
        console.error("[notion] conflict insert error:", formatPostgrestErrorDiagnostic(conflictErr));
      }

      await client
        .from("notion_page_links")
        .update({
          status: "conflict",
          last_observed_local_fingerprint: currentLocalFingerprint,
          last_observed_remote_fingerprint: currentRemoteFingerprint,
        })
        .eq("id", link.id);

      return { ok: false, message: "Sync paused due to concurrent edits.", actionTaken: "conflict" };
    }

    case "upgrade_review": {
      await client
        .from("notion_page_links")
        .update({ status: "upgrade_review" })
        .eq("id", link.id);
      return { ok: false, message: "Converter upgrade review required.", actionTaken: "upgrade_review" };
    }
  }
}

/** Resolves an open conflict by keeping Redline or adopting Notion. */
export async function resolveNotionConflict(
  conflictId: string,
  resolution: NotionConflictResolution,
): Promise<{ ok: boolean; message: string }> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const conflictRes = await client
    .from("notion_sync_conflicts")
    .select("*")
    .eq("id", conflictId)
    .eq("user_id", userId)
    .eq("status", "open")
    .maybeSingle();

  if (conflictRes.error || !conflictRes.data) {
    return { ok: false, message: "Open conflict not found." };
  }

  const conflict = toNotionSyncConflict(conflictRes.data as ConflictRow);
  const targetDoc = resolution === "use_notion" ? conflict.remoteSnapshot : conflict.localSnapshot;
  const targetFp = resolution === "use_notion" ? conflict.remoteFingerprint : conflict.localFingerprint;
  const { markdown } = canonicalAstToMarkdown(targetDoc);

  const rpcRes = await client.rpc("notion_resolve_conflict", {
    p_conflict_id: conflictId,
    p_resolution: resolution,
    p_new_title: targetDoc.title,
    p_new_body: markdown,
    p_new_snapshot: targetDoc,
    p_new_fp: targetFp,
    p_remote_revision: conflict.remoteRevision,
  });

  if (rpcRes.error) {
    console.error("[notion] resolve conflict RPC error:", formatPostgrestErrorDiagnostic(rpcRes.error));
    return { ok: false, message: "Could not resolve conflict." };
  }

  return { ok: true, message: `Conflict resolved by choosing ${resolution === "use_notion" ? "Notion" : "Forward"}.` };
}

/** Unlinks a note from Notion. */
export async function unlinkNotionPage(noteId: string): Promise<{ ok: boolean; message: string }> {
  const { client } = await requireAuthenticatedSupabase();

  const link = await getNotionPageLinkForNote(noteId);
  if (!link) {
    return { ok: false, message: "Note is not linked." };
  }

  const rpcRes = await client.rpc("notion_retire_link", { p_link_id: link.id });
  if (rpcRes.error) {
    console.error("[notion] retire link RPC error:", formatPostgrestErrorDiagnostic(rpcRes.error));
    return { ok: false, message: "Could not unlink note." };
  }

  return { ok: true, message: "Note unlinked from Notion." };
}

/** Updates sync direction for a linked note. */
export async function updateNotionLinkDirection(
  noteId: string,
  direction: NotionSyncDirection,
): Promise<{ ok: boolean; message: string }> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const link = await getNotionPageLinkForNote(noteId);
  if (!link) {
    return { ok: false, message: "Note is not linked." };
  }

  const { error } = await client
    .from("notion_page_links")
    .update({ direction, updated_at: new Date().toISOString() })
    .eq("id", link.id)
    .eq("user_id", userId);

  if (error) {
    console.error("[notion] update direction error:", formatPostgrestErrorDiagnostic(error));
    return { ok: false, message: "Could not update sync direction." };
  }

  return { ok: true, message: `Sync direction updated to ${direction === "selective_two_way" ? "Two-Way" : "Export Only"}.` };
}
