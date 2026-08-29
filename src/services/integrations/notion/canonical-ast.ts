import { createHash } from "node:crypto";

import type {
  CanonicalBlock,
  CanonicalDocument,
  CanonicalInline,
  NotionBlockDto,
  NotionRichTextDto,
} from "./types";

export const CONVERTER_VERSION = 1;

/** Redacts sensitive tokens from any error or string. */
export function redactSecret(text: string): string {
  return text.replace(/secret_[a-zA-Z0-9_-]+/g, "secret_***");
}

export class UnsupportedContentError extends Error {
  constructor(
    message: string,
    public readonly unsupportedBlocks: string[] = [],
  ) {
    super(message);
    this.name = "UnsupportedContentError";
  }
}

/** Validates that URLs only use allowed schemes (https, http, mailto). */
export function isValidLinkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:" ||
      parsed.protocol === "mailto:"
    );
  } catch {
    // Relative URLs or invalid URLs are not allowed
    return false;
  }
}

/** Parse markdown text with inline markup into CanonicalInline array. */
export function parseInlineMarkdown(text: string): CanonicalInline[] {
  if (!text) return [];

  const inlines: CanonicalInline[] = [];
  // Regex for code, links, bold, italic, strikethrough
  // Tokenizer pattern:
  // 1. `code`
  // 2. [text](url)
  // 3. **bold**
  // 4. ~~strikethrough~~
  // 5. *italic* or _italic_
  const inlineRegex =
    /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*]+\*|_([^_]+)_)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      inlines.push({ text: text.slice(lastIndex, match.index) });
    }

    const matchedStr = match[0];
    if (matchedStr.startsWith("`") && matchedStr.endsWith("`")) {
      inlines.push({ text: matchedStr.slice(1, -1), code: true });
    } else if (matchedStr.startsWith("[") && matchedStr.includes("](")) {
      const closingBracket = matchedStr.indexOf("]");
      const linkText = matchedStr.slice(1, closingBracket);
      const linkUrl = matchedStr.slice(closingBracket + 2, -1);
      if (!isValidLinkUrl(linkUrl)) {
        throw new UnsupportedContentError(
          `Unsafe or invalid link scheme: "${linkUrl}"`,
        );
      }
      inlines.push({ text: linkText, href: linkUrl });
    } else if (matchedStr.startsWith("**") && matchedStr.endsWith("**")) {
      inlines.push({ text: matchedStr.slice(2, -2), bold: true });
    } else if (matchedStr.startsWith("~~") && matchedStr.endsWith("~~")) {
      inlines.push({ text: matchedStr.slice(2, -2), strikethrough: true });
    } else if (
      (matchedStr.startsWith("*") && matchedStr.endsWith("*")) ||
      (matchedStr.startsWith("_") && matchedStr.endsWith("_"))
    ) {
      inlines.push({ text: matchedStr.slice(1, -1), italic: true });
    }

    lastIndex = match.index + matchedStr.length;
  }

  if (lastIndex < text.length) {
    inlines.push({ text: text.slice(lastIndex) });
  }

  return inlines;
}

/** Serialize CanonicalInline array to Markdown string. */
export function inlinesToMarkdown(inlines: CanonicalInline[]): string {
  return inlines
    .map((inline) => {
      let t = inline.text;
      if (inline.code) return `\`${t}\``;
      if (inline.bold) t = `**${t}**`;
      if (inline.italic) t = `*${t}*`;
      if (inline.strikethrough) t = `~~${t}~~`;
      if (inline.href) t = `[${t}](${inline.href})`;
      return t;
    })
    .join("");
}

/** Parse Redline Markdown string into CanonicalDocument. */
export function markdownToCanonicalAst(
  title: string,
  markdown: string,
): CanonicalDocument {
  const normalizedTitle = title.trim();
  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n");
  const lines = normalizedMarkdown.split("\n");
  const body: CanonicalBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Check for unsupported HTML
    if (/<[a-z][\s\S]*>/i.test(line)) {
      throw new UnsupportedContentError("HTML tags are not supported.");
    }

    // Check for unsupported Tables
    if (/^\|.*\|$/.test(line.trim())) {
      throw new UnsupportedContentError("Tables are not supported.");
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      if (level > 3) {
        throw new UnsupportedContentError(
          `Headings deeper than level 3 (####) are unsupported (found level ${level}).`,
        );
      }
      body.push({
        type: "heading",
        level: level as 1 | 2 | 3,
        inlines: parseInlineMarkdown(headingMatch[2]),
      });
      i++;
      continue;
    }

    // Fenced Code block
    if (line.trim().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith("```")) {
        i++; // skip closing ```
      }
      body.push({
        type: "code",
        text: codeLines.join("\n"),
        language: language || "plain text",
      });
      continue;
    }

    // Blockquote
    if (line.startsWith("> ") || line === ">") {
      const quoteText = line.startsWith("> ") ? line.slice(2) : line.slice(1);
      body.push({
        type: "quote",
        inlines: parseInlineMarkdown(quoteText),
      });
      i++;
      continue;
    }

    // To-Do / Checklist
    const todoMatch = line.match(/^(\s*)-\s+\[([ xX])\]\s+(.*)$/);
    if (todoMatch) {
      const checked = todoMatch[2].toLowerCase() === "x";
      body.push({
        type: "to_do",
        checked,
        inlines: parseInlineMarkdown(todoMatch[3]),
      });
      i++;
      continue;
    }

    // Bulleted list item
    const bulletMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bulletMatch) {
      const indent = bulletMatch[1].length;
      if (indent > 4) {
        throw new UnsupportedContentError("List nesting deeper than 3 levels is unsupported.");
      }
      body.push({
        type: "bulleted_list_item",
        inlines: parseInlineMarkdown(bulletMatch[2]),
      });
      i++;
      continue;
    }

    // Numbered list item
    const numMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (numMatch) {
      const indent = numMatch[1].length;
      if (indent > 4) {
        throw new UnsupportedContentError("List nesting deeper than 3 levels is unsupported.");
      }
      body.push({
        type: "numbered_list_item",
        inlines: parseInlineMarkdown(numMatch[2]),
      });
      i++;
      continue;
    }

    // Standard Paragraph
    body.push({
      type: "paragraph",
      inlines: parseInlineMarkdown(line),
    });
    i++;
  }

  return {
    version: CONVERTER_VERSION,
    title: normalizedTitle,
    body,
  };
}

/** Serialize CanonicalDocument back to Markdown. */
export function canonicalAstToMarkdown(doc: CanonicalDocument): {
  title: string;
  markdown: string;
} {
  const parts: string[] = [];

  for (const block of doc.body) {
    switch (block.type) {
      case "heading": {
        const hashes = "#".repeat(block.level);
        parts.push(`${hashes} ${inlinesToMarkdown(block.inlines)}`);
        break;
      }
      case "paragraph":
        parts.push(inlinesToMarkdown(block.inlines));
        break;
      case "bulleted_list_item":
        parts.push(`- ${inlinesToMarkdown(block.inlines)}`);
        break;
      case "numbered_list_item":
        parts.push(`1. ${inlinesToMarkdown(block.inlines)}`);
        break;
      case "to_do":
        parts.push(`- [${block.checked ? "x" : " "}] ${inlinesToMarkdown(block.inlines)}`);
        break;
      case "code":
        parts.push(`\`\`\`${block.language || ""}\n${block.text}\n\`\`\``);
        break;
      case "quote":
        parts.push(`> ${inlinesToMarkdown(block.inlines)}`);
        break;
    }
  }

  return {
    title: doc.title,
    markdown: parts.join("\n\n"),
  };
}

/** Convert CanonicalInlines to Notion RichText DTO array. */
export function inlinesToNotionRichText(
  inlines: CanonicalInline[],
): NotionRichTextDto[] {
  if (!inlines || inlines.length === 0) return [];

  return inlines.map((inline) => ({
    type: "text",
    text: {
      content: inline.text,
      link: inline.href ? { url: inline.href } : null,
    },
    annotations: {
      bold: Boolean(inline.bold),
      italic: Boolean(inline.italic),
      strikethrough: Boolean(inline.strikethrough),
      underline: false,
      code: Boolean(inline.code),
      color: "default",
    },
    plain_text: inline.text,
    href: inline.href ?? null,
  }));
}

/** Convert Notion RichText DTO array to CanonicalInlines. */
export function notionRichTextToInlines(
  richText: NotionRichTextDto[],
): CanonicalInline[] {
  if (!richText || !Array.isArray(richText)) return [];

  const inlines: CanonicalInline[] = [];
  for (const item of richText) {
    if (item.type !== "text" || !item.text) {
      continue;
    }
    const text = item.text.content || item.plain_text || "";
    if (!text) continue;

    const inline: CanonicalInline = { text };
    if (item.annotations?.bold) inline.bold = true;
    if (item.annotations?.italic) inline.italic = true;
    if (item.annotations?.strikethrough) inline.strikethrough = true;
    if (item.annotations?.code) inline.code = true;
    if (item.text.link?.url) {
      const url = item.text.link.url;
      if (!isValidLinkUrl(url)) {
        throw new UnsupportedContentError(`Unsafe link scheme in Notion: "${url}"`);
      }
      inline.href = url;
    }
    inlines.push(inline);
  }
  return inlines;
}

/** Convert CanonicalDocument body to Notion Block DTOs (for children of managed root toggle). */
export function canonicalAstToNotionBlocks(doc: CanonicalDocument): NotionBlockDto[] {
  const blocks: NotionBlockDto[] = [
    // The first block inside the managed root is the heading_1 carrying the Redline title
    {
      type: "heading_1",
      heading_1: {
        rich_text: [
          {
            type: "text",
            text: { content: doc.title, link: null },
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: "default",
            },
            plain_text: doc.title,
            href: null,
          },
        ],
        color: "default",
        is_toggleable: false,
      },
    },
  ];

  for (const block of doc.body) {
    switch (block.type) {
      case "heading": {
        const type = `heading_${block.level}` as const;
        blocks.push({
          type,
          [type]: {
            rich_text: inlinesToNotionRichText(block.inlines),
            color: "default",
            is_toggleable: false,
          },
        });
        break;
      }
      case "paragraph":
        blocks.push({
          type: "paragraph",
          paragraph: {
            rich_text: inlinesToNotionRichText(block.inlines),
            color: "default",
          },
        });
        break;
      case "bulleted_list_item":
        blocks.push({
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: inlinesToNotionRichText(block.inlines),
            color: "default",
          },
        });
        break;
      case "numbered_list_item":
        blocks.push({
          type: "numbered_list_item",
          numbered_list_item: {
            rich_text: inlinesToNotionRichText(block.inlines),
            color: "default",
          },
        });
        break;
      case "to_do":
        blocks.push({
          type: "to_do",
          to_do: {
            rich_text: inlinesToNotionRichText(block.inlines),
            checked: block.checked,
            color: "default",
          },
        });
        break;
      case "code":
        blocks.push({
          type: "code",
          code: {
            rich_text: [
              {
                type: "text",
                text: { content: block.text, link: null },
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: "default",
                },
                plain_text: block.text,
                href: null,
              },
            ],
            language: block.language || "plain text",
          },
        });
        break;
      case "quote":
        blocks.push({
          type: "quote",
          quote: {
            rich_text: inlinesToNotionRichText(block.inlines),
            color: "default",
          },
        });
        break;
    }
  }

  return blocks;
}

/** Convert Notion managed root children back to CanonicalDocument. */
export function notionBlocksToCanonicalAst(
  rootChildren: NotionBlockDto[],
): { ok: true; doc: CanonicalDocument } | { ok: false; reason: string; unsupportedBlocks: string[] } {
  if (!rootChildren || rootChildren.length === 0) {
    return {
      ok: true,
      doc: {
        version: CONVERTER_VERSION,
        title: "Untitled Note",
        body: [],
      },
    };
  }

  const unsupported: string[] = [];
  let title = "Untitled Note";
  let bodyStartIndex = 0;

  // The first child is expected to be a heading_1 carrying the Redline title
  const firstBlock = rootChildren[0];
  if (firstBlock.type === "heading_1" && firstBlock.heading_1) {
    const headingRichText = (firstBlock.heading_1 as { rich_text: NotionRichTextDto[] }).rich_text;
    title = headingRichText?.map((r) => r.plain_text).join("").trim() || "Untitled Note";
    bodyStartIndex = 1;
  }

  const body: CanonicalBlock[] = [];

  for (let i = bodyStartIndex; i < rootChildren.length; i++) {
    const block = rootChildren[i];
    if (block.archived) continue;

    try {
      switch (block.type) {
        case "heading_1":
        case "heading_2":
        case "heading_3": {
          const level = Number(block.type.slice(-1)) as 1 | 2 | 3;
          const content = block[block.type] as { rich_text: NotionRichTextDto[] };
          body.push({
            type: "heading",
            level,
            inlines: notionRichTextToInlines(content.rich_text),
          });
          break;
        }
        case "paragraph": {
          const content = block.paragraph as { rich_text: NotionRichTextDto[] };
          body.push({
            type: "paragraph",
            inlines: notionRichTextToInlines(content.rich_text),
          });
          break;
        }
        case "bulleted_list_item": {
          const content = block.bulleted_list_item as { rich_text: NotionRichTextDto[] };
          body.push({
            type: "bulleted_list_item",
            inlines: notionRichTextToInlines(content.rich_text),
          });
          break;
        }
        case "numbered_list_item": {
          const content = block.numbered_list_item as { rich_text: NotionRichTextDto[] };
          body.push({
            type: "numbered_list_item",
            inlines: notionRichTextToInlines(content.rich_text),
          });
          break;
        }
        case "to_do": {
          const content = block.to_do as { rich_text: NotionRichTextDto[]; checked: boolean };
          body.push({
            type: "to_do",
            checked: Boolean(content.checked),
            inlines: notionRichTextToInlines(content.rich_text),
          });
          break;
        }
        case "code": {
          const content = block.code as { rich_text: NotionRichTextDto[]; language: string };
          const codeText = content.rich_text?.map((r) => r.plain_text).join("") || "";
          body.push({
            type: "code",
            text: codeText,
            language: content.language || "plain text",
          });
          break;
        }
        case "quote": {
          const content = block.quote as { rich_text: NotionRichTextDto[] };
          body.push({
            type: "quote",
            inlines: notionRichTextToInlines(content.rich_text),
          });
          break;
        }
        default:
          unsupported.push(`${block.type}:${block.id || i}`);
          break;
      }
    } catch (err) {
      if (err instanceof UnsupportedContentError) {
        unsupported.push(`error:${err.message}`);
      } else {
        unsupported.push(`error:${block.type}`);
      }
    }
  }

  if (unsupported.length > 0) {
    return {
      ok: false,
      reason: `Found ${unsupported.length} unsupported remote block(s).`,
      unsupportedBlocks: unsupported,
    };
  }

  return {
    ok: true,
    doc: {
      version: CONVERTER_VERSION,
      title,
      body,
    },
  };
}

/** Compute deterministic SHA-256 fingerprint for CanonicalDocument. */
export function computeCanonicalFingerprint(doc: CanonicalDocument): string {
  // Sort keys deterministically
  const canonicalString = JSON.stringify(doc, (key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce((sorted: Record<string, unknown>, k) => {
          sorted[k] = value[k];
          return sorted;
        }, {});
    }
    return value;
  });

  return createHash("sha256").update(canonicalString, "utf8").digest("hex");
}

/** Compute SHA-256 fingerprint from title and markdown directly. */
export function computeMarkdownFingerprint(
  title: string,
  markdown: string,
): string {
  const doc = markdownToCanonicalAst(title, markdown);
  return computeCanonicalFingerprint(doc);
}

/** Build the exact versioned Forward link/attempt marker label for the top-level toggle. */
export function buildManagedRootMarker(
  linkId: string,
  converterVersion: number,
  attemptId: string,
): string {
  return `⚡ Forward Sync [link:${linkId}] [v:${converterVersion}] [attempt:${attemptId}]`;
}

/** Parse marker string from a toggle block. */
export function parseManagedRootMarker(
  markerText: string,
): { linkId: string; converterVersion: number; attemptId: string } | null {
  const match = markerText.match(
    /⚡ Forward Sync \[link:([^\s\]]+)\] \[v:(\d+)\] \[attempt:([^\s\]]+)\]/,
  );
  if (!match) return null;
  return {
    linkId: match[1],
    converterVersion: Number(match[2]),
    attemptId: match[3],
  };
}
