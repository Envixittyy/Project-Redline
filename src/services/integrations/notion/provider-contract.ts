export type NotionSyncDirection = "forward_to_notion" | "selective_two_way";

export type NotionPageLink = {
  localEntityType: "note" | "knowledge_page";
  localEntityId: string;
  remoteWorkspaceId: string;
  remotePageId: string;
  remoteUrl: string;
  direction: NotionSyncDirection;
  lastLocalRevision: string;
  lastRemoteRevision: string;
  /** Content fingerprint written by Forward and used to suppress echo loops. */
  lastPushedFingerprint: string | null;
};

export type NotionPageDraft = {
  title: string;
  markdown: string;
  parentRemotePageId?: string;
};

export interface NotionKnowledgeProvider {
  createPage(draft: NotionPageDraft): Promise<{ remotePageId: string; remoteUrl: string; revision: string }>;
  updatePage(link: NotionPageLink, draft: NotionPageDraft): Promise<{ revision: string }>;
  getPage(link: NotionPageLink): Promise<{ title: string; markdown: string; revision: string }>;
}

/** Persistent IDs are mandatory; title matching is never a synchronization key. */
export function canSynchronizeNotionLink(link: Partial<NotionPageLink>): link is NotionPageLink {
  return Boolean(link.localEntityId && link.remoteWorkspaceId && link.remotePageId);
}
