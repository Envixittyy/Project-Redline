export type NotionSyncDirection = "forward_to_notion" | "selective_two_way";

export type NotionPageLinkStatus =
  | "linked"
  | "synced"
  | "local_pending"
  | "remote_pending"
  | "syncing"
  | "conflict"
  | "unsupported"
  | "upgrade_review"
  | "cleanup_pending"
  | "remote_missing"
  | "remote_structure_changed"
  | "local_archived"
  | "error"
  | "disconnected"
  | "attention"
  | "retired";

export type NotionConflictResolution = "keep_redline" | "use_notion";

export type CanonicalInline = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  href?: string | null;
};

export type CanonicalBlock =
  | { type: "heading"; level: 1 | 2 | 3; inlines: CanonicalInline[] }
  | { type: "paragraph"; inlines: CanonicalInline[] }
  | { type: "bulleted_list_item"; inlines: CanonicalInline[]; children?: CanonicalBlock[] }
  | { type: "numbered_list_item"; inlines: CanonicalInline[]; children?: CanonicalBlock[] }
  | { type: "to_do"; checked: boolean; inlines: CanonicalInline[] }
  | { type: "code"; text: string; language: string }
  | { type: "quote"; inlines: CanonicalInline[] };

export type CanonicalDocument = {
  version: number;
  title: string;
  body: CanonicalBlock[];
};

export type NotionRichTextDto = {
  type: "text";
  text: {
    content: string;
    link: { url: string } | null;
  };
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: string;
  };
  plain_text: string;
  href: string | null;
};

export type NotionBlockDto = {
  id?: string;
  type: string;
  has_children?: boolean;
  archived?: boolean;
  last_edited_time?: string;
  [key: string]: unknown;
};

export type NotionPageLink = {
  id: string;
  userId: string;
  accountId: string;
  noteId: string;
  workspaceId: string;
  remotePageId: string;
  remoteRootBlockId: string | null;
  remoteUrl: string;
  direction: NotionSyncDirection;
  converterVersion: number;
  baseSnapshot: CanonicalDocument | null;
  baseLocalFingerprint: string | null;
  baseRemoteFingerprint: string | null;
  lastObservedLocalFingerprint: string | null;
  lastObservedRemoteFingerprint: string | null;
  lastPushedFingerprint: string | null;
  lastRemoteRevision: string | null;
  activeAttemptId: string | null;
  pendingAttemptId: string | null;
  pendingRootBlockId: string | null;
  status: NotionPageLinkStatus;
  lastErrorCode: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NotionSyncConflict = {
  id: string;
  userId: string;
  linkId: string;
  baseSnapshot: CanonicalDocument;
  localSnapshot: CanonicalDocument;
  remoteSnapshot: CanonicalDocument;
  baseFingerprint: string;
  localFingerprint: string;
  remoteFingerprint: string;
  remoteRevision: string;
  status: "open" | "resolved";
  resolution: NotionConflictResolution | null;
  resolvedFingerprint: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NotionAccountStatus = {
  connected: boolean;
  accountId: string | null;
  credentialHint: string | null;
  syncState: string;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  activeLinksCount: number;
  conflictsCount: number;
};
