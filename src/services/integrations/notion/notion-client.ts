import { redactSecret } from "./canonical-ast";
import type { NotionBlockDto } from "./types";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_API_VERSION = "2022-06-28";

export class NotionClientError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "unauthorized"
      | "forbidden"
      | "not_found"
      | "rate_limited"
      | "network_error"
      | "api_error"
      | "invalid_request",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "NotionClientError";
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type NotionFetchOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

/** Executes authenticated, rate-limit aware fetch to Notion API. */
export async function notionFetch<T>(
  token: string,
  endpoint: string,
  options: NotionFetchOptions = {},
): Promise<T> {
  const url = `${NOTION_API_BASE}${endpoint}`;
  let attempt = 0;
  const maxAttempts = 4;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_API_VERSION,
          "Content-Type": "application/json",
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        cache: "no-store",
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      if (response.status === 401) {
        throw new NotionClientError("Invalid or revoked Notion token.", "unauthorized", 401);
      }

      if (response.status === 403) {
        throw new NotionClientError("Permission denied for this Notion page or workspace.", "forbidden", 403);
      }

      if (response.status === 404) {
        throw new NotionClientError("The requested Notion page or block was not found.", "not_found", 404);
      }

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("Retry-After");
        const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : 1;
        const delayMs = Math.min(Math.max(retryAfterSec * 1000, 1000), 10000);
        if (attempt < maxAttempts) {
          await sleep(delayMs);
          continue;
        }
        throw new NotionClientError("Notion rate limit exceeded. Please try again shortly.", "rate_limited", 429);
      }

      if (response.status >= 500) {
        if (attempt < maxAttempts) {
          await sleep(attempt * 1000);
          continue;
        }
        throw new NotionClientError("Notion service is temporarily unavailable.", "api_error", response.status);
      }

      const errorJson = (await response.json().catch(() => ({}))) as { message?: string };
      const safeMessage = errorJson.message
        ? redactSecret(errorJson.message)
        : `Notion API request failed with status ${response.status}.`;

      throw new NotionClientError(safeMessage, "invalid_request", response.status);
    } catch (err) {
      if (err instanceof NotionClientError) {
        throw err;
      }
      if (attempt < maxAttempts) {
        await sleep(attempt * 500);
        continue;
      }
      throw new NotionClientError(
        "Could not connect to Notion. Please check your network connection.",
        "network_error",
      );
    }
  }

  throw new NotionClientError("Request to Notion timed out.", "api_error");
}

export type NotionTokenInfo = {
  botId: string;
  workspaceName: string;
  workspaceId: string;
};

/** Validates a Notion integration token. */
export async function validateNotionToken(token: string): Promise<NotionTokenInfo> {
  const me = await notionFetch<{
    id: string;
    bot?: { owner?: { type?: string; workspace?: boolean } };
    name?: string;
  }>(token, "/users/me");

  return {
    botId: me.id,
    workspaceName: me.name || "Notion Workspace",
    workspaceId: me.id,
  };
}

/** Fetches high-level metadata for a Notion page. */
export async function fetchNotionPageMetadata(
  token: string,
  pageId: string,
): Promise<{ id: string; url: string; archived: boolean; lastEditedTime: string } | null> {
  try {
    const page = await notionFetch<{
      id: string;
      url: string;
      archived: boolean;
      last_edited_time: string;
    }>(token, `/pages/${encodeURIComponent(pageId)}`);

    return {
      id: page.id,
      url: page.url,
      archived: Boolean(page.archived),
      lastEditedTime: page.last_edited_time,
    };
  } catch (err) {
    if (err instanceof NotionClientError && err.code === "not_found") {
      return null;
    }
    throw err;
  }
}

/** Creates a new page inside parentPageId with initial managed root toggle and child blocks. */
export async function createPageWithManagedRoot(
  token: string,
  parentPageId: string,
  title: string,
  marker: string,
  blocks: NotionBlockDto[],
): Promise<{ pageId: string; pageUrl: string; rootBlockId: string }> {
  // Notion allows creating child blocks inside toggle on page creation
  const body = {
    parent: { page_id: parentPageId },
    properties: {
      title: {
        title: [{ text: { content: title } }],
      },
    },
    children: [
      {
        object: "block",
        type: "toggle",
        toggle: {
          rich_text: [{ text: { content: marker } }],
          children: blocks.map((b) => ({ object: "block", ...b })),
        },
      },
    ],
  };

  const response = await notionFetch<{
    id: string;
    url: string;
  }>(token, "/pages", {
    method: "POST",
    body,
  });

  // Fetch the created children to get the root toggle block ID
  const childrenResponse = await notionFetch<{
    results: Array<{ id: string; type: string }>;
  }>(token, `/blocks/${encodeURIComponent(response.id)}/children?page_size=10`);

  const toggle = childrenResponse.results.find((b) => b.type === "toggle");
  if (!toggle) {
    throw new NotionClientError(
      "Created Notion page but could not locate the managed root toggle block.",
      "api_error",
    );
  }

  return {
    pageId: response.id,
    pageUrl: response.url,
    rootBlockId: toggle.id,
  };
}

/** Appends a new staged managed root toggle block with children to an existing page. */
export async function appendStagedRoot(
  token: string,
  pageId: string,
  marker: string,
  blocks: NotionBlockDto[],
): Promise<{ rootBlockId: string }> {
  const body = {
    children: [
      {
        object: "block",
        type: "toggle",
        toggle: {
          rich_text: [{ text: { content: marker } }],
          children: blocks.map((b) => ({ object: "block", ...b })),
        },
      },
    ],
  };

  const response = await notionFetch<{
    results: Array<{ id: string; type: string }>;
  }>(token, `/blocks/${encodeURIComponent(pageId)}/children`, {
    method: "PATCH",
    body,
  });

  const toggle = response.results.find((b) => b.type === "toggle");
  if (!toggle) {
    throw new NotionClientError(
      "Appended staged root but could not locate the created toggle block ID.",
      "api_error",
    );
  }

  return { rootBlockId: toggle.id };
}

/** Fetches managed root toggle block and all its descendant children. */
export async function fetchManagedRoot(
  token: string,
  rootBlockId: string,
): Promise<
  | { ok: true; root: NotionBlockDto; children: NotionBlockDto[]; lastEditedTime: string }
  | { ok: false; error: "not_found" | "forbidden" | "unsupported" }
> {
  try {
    const rootBlock = await notionFetch<NotionBlockDto>(
      token,
      `/blocks/${encodeURIComponent(rootBlockId)}`,
    );

    if (rootBlock.type !== "toggle") {
      return { ok: false, error: "unsupported" };
    }

    const allChildren: NotionBlockDto[] = [];
    let cursor: string | undefined = undefined;

    do {
      const url: string = cursor
        ? `/blocks/${encodeURIComponent(rootBlockId)}/children?page_size=100&start_cursor=${encodeURIComponent(cursor)}`
        : `/blocks/${encodeURIComponent(rootBlockId)}/children?page_size=100`;

      const page = await notionFetch<{
        results: NotionBlockDto[];
        has_more: boolean;
        next_cursor?: string;
      }>(token, url);

      allChildren.push(...page.results);
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);

    return {
      ok: true,
      root: rootBlock,
      children: allChildren,
      lastEditedTime: (rootBlock.last_edited_time as string) || new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof NotionClientError) {
      if (err.code === "not_found") return { ok: false, error: "not_found" };
      if (err.code === "forbidden") return { ok: false, error: "forbidden" };
    }
    return { ok: false, error: "unsupported" };
  }
}

/** Archives (deletes) a block on Notion. */
export async function archiveNotionBlock(token: string, blockId: string): Promise<void> {
  try {
    await notionFetch(token, `/blocks/${encodeURIComponent(blockId)}`, {
      method: "DELETE",
    });
  } catch (err) {
    // Non-fatal if already missing
    if (err instanceof NotionClientError && err.code === "not_found") {
      return;
    }
    throw err;
  }
}
