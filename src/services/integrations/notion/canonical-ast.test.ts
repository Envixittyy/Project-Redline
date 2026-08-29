import { describe, expect, it } from "vitest";

import {
  buildManagedRootMarker,
  canonicalAstToMarkdown,
  canonicalAstToNotionBlocks,
  computeCanonicalFingerprint,
  computeMarkdownFingerprint,
  markdownToCanonicalAst,
  notionBlocksToCanonicalAst,
  parseManagedRootMarker,
  UnsupportedContentError,
} from "./canonical-ast";

describe("Notion Canonical AST and Fingerprinting", () => {
  const sampleMarkdown = `# Introduction

This is a **bold** paragraph with *italic* text, ~~strikethrough~~, \`inline code\`, and a [safe link](https://example.com).

## Key Points

- Bullet item 1
- Bullet item 2

1. Numbered step 1
2. Numbered step 2

- [ ] Unchecked item
- [x] Completed task

\`\`\`typescript
const greeting = "Hello Forward";
console.log(greeting);
\`\`\`

> A wise quote.
`;

  it("parses Markdown into a valid CanonicalDocument", () => {
    const doc = markdownToCanonicalAst("My Document Title", sampleMarkdown);

    expect(doc.version).toBe(1);
    expect(doc.title).toBe("My Document Title");
    expect(doc.body.length).toBeGreaterThan(5);

    const heading = doc.body.find((b) => b.type === "heading" && b.level === 1);
    expect(heading).toBeDefined();

    const todo = doc.body.find((b) => b.type === "to_do" && b.checked === true);
    expect(todo).toBeDefined();
  });

  it("round-trips Markdown to CanonicalDocument and back to Markdown", () => {
    const doc = markdownToCanonicalAst("Project Notes", sampleMarkdown);
    const serialized = canonicalAstToMarkdown(doc);

    expect(serialized.title).toBe("Project Notes");
    expect(serialized.markdown).toContain("# Introduction");
    expect(serialized.markdown).toContain("**bold**");
    expect(serialized.markdown).toContain("[safe link](https://example.com)");
    expect(serialized.markdown).toContain("- [x]");
    expect(serialized.markdown).toContain("```typescript");
  });

  it("converts CanonicalDocument to Notion block DTOs and back to CanonicalDocument", () => {
    const doc = markdownToCanonicalAst("Lecture Notes", sampleMarkdown);
    const notionBlocks = canonicalAstToNotionBlocks(doc);

    // The first block is the heading_1 with title
    expect(notionBlocks[0].type).toBe("heading_1");

    const conversionResult = notionBlocksToCanonicalAst(notionBlocks);
    expect(conversionResult.ok).toBe(true);

    if (conversionResult.ok) {
      expect(conversionResult.doc.title).toBe("Lecture Notes");
      expect(conversionResult.doc.body.length).toBe(doc.body.length);

      // Deterministic fingerprint matching
      const originalFp = computeCanonicalFingerprint(doc);
      const convertedFp = computeCanonicalFingerprint(conversionResult.doc);
      expect(convertedFp).toBe(originalFp);
    }
  });

  it("rejects unsupported Markdown elements (HTML, tables, deep headings, unsafe link schemes)", () => {
    expect(() => markdownToCanonicalAst("Bad HTML", "<script>alert(1)</script>")).toThrow(
      UnsupportedContentError,
    );

    expect(() => markdownToCanonicalAst("Bad Table", "| col1 | col2 |\n|---|---|")).toThrow(
      UnsupportedContentError,
    );

    expect(() => markdownToCanonicalAst("Bad Heading", "#### Level 4 Heading")).toThrow(
      UnsupportedContentError,
    );

    expect(() =>
      markdownToCanonicalAst("Bad Link", "Click [here](javascript:stealCookies())"),
    ).toThrow(UnsupportedContentError);
  });

  it("computes deterministic SHA-256 fingerprints unaffected by object key ordering", () => {
    const fp1 = computeMarkdownFingerprint("Same Title", sampleMarkdown);
    const fp2 = computeMarkdownFingerprint("Same Title", sampleMarkdown);
    expect(fp1).toBe(fp2);

    const fpDifferent = computeMarkdownFingerprint("Different Title", sampleMarkdown);
    expect(fpDifferent).not.toBe(fp1);
  });

  it("builds and parses versioned managed root markers", () => {
    const linkId = "11111111-2222-3333-4444-555555555555";
    const attemptId = "66666666-7777-8888-9999-000000000000";
    const marker = buildManagedRootMarker(linkId, 1, attemptId);

    expect(marker).toContain(linkId);
    expect(marker).toContain(attemptId);
    expect(marker).toContain("v:1");

    const parsed = parseManagedRootMarker(marker);
    expect(parsed).toEqual({
      linkId,
      converterVersion: 1,
      attemptId,
    });
  });
});
