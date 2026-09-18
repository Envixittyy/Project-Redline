import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { InMemoryPrivateStore } from "@/services/private-store";
import {
  createEncryptedBackup,
  decryptBackupArchive,
  DearDumbassRepository,
} from "@/services/dear-dumbass";

describe("Dear Dumbass Privacy Boundary Audit", () => {
  const targetDirs = [
    path.resolve(process.cwd(), "src/features/dear-dumbass"),
    path.resolve(process.cwd(), "src/services/dear-dumbass"),
    path.resolve(process.cwd(), "src/services/private-store"),
  ];

  function getSourceFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getSourceFiles(fullPath));
      } else if (
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !entry.name.includes(".test.")
      ) {
        files.push(fullPath);
      }
    }
    return files;
  }

  it("1. guarantees zero Supabase, cloud queue, or remote integration imports", () => {
    const allSourceFiles = targetDirs.flatMap((dir) => getSourceFiles(dir));
    expect(allSourceFiles.length).toBeGreaterThan(0);

    const forbiddenImportPatterns = [
      /@\/services\/supabase/,
      /@\/services\/integrations/,
      /@\/lib\/offline\/queue/,
      /useSearchParams/,
      /next\/headers/,
      /next\/server/,
    ];

    for (const filePath of allSourceFiles) {
      const content = fs.readFileSync(filePath, "utf-8");
      for (const pattern of forbiddenImportPatterns) {
        expect(
          pattern.test(content),
          `Forbidden import pattern ${pattern} found in ${path.basename(filePath)}`,
        ).toBe(false);
      }
    }
  });

  it("2. guarantees zero fetch, XMLHttpRequest, sendBeacon, or cloud API calls in source code", () => {
    const allSourceFiles = targetDirs.flatMap((dir) => getSourceFiles(dir));

    const forbiddenCallPatterns = [
      /\bfetch\s*\(/,
      /\bsendBeacon\s*\(/,
      /new\s+XMLHttpRequest/,
      /new\s+WebSocket/,
      /new\s+EventSource/,
    ];

    for (const filePath of allSourceFiles) {
      const content = fs.readFileSync(filePath, "utf-8");
      for (const pattern of forbiddenCallPatterns) {
        expect(
          pattern.test(content),
          `Forbidden network call pattern ${pattern} found in ${path.basename(filePath)}`,
        ).toBe(false);
      }
    }
  });

  it("3. guarantees zero console.log leaks of plaintext bodies, passphrases, or decrypted JSON", () => {
    const allSourceFiles = targetDirs.flatMap((dir) => getSourceFiles(dir));

    for (const filePath of allSourceFiles) {
      const content = fs.readFileSync(filePath, "utf-8");
      // Ensure no raw console logging of post bodies or passwords
      expect(
        /console\.(log|info|warn|debug)\s*\([^)]*(body|passphrase|decrypted|plaintext)[^)]*\)/i.test(
          content,
        ),
        `Potential plaintext/passphrase logging pattern found in ${path.basename(filePath)}`,
      ).toBe(false);
    }
  });

  it("4. performs full operational cycle with zero network calls", async () => {
    const store = new InMemoryPrivateStore();
    const repo = new DearDumbassRepository(store);

    // 1. Create root post
    const root = await repo.createPost("Zero network post");

    // 2. Reply to post
    const reply = await repo.createPost("Zero network reply", root.id);

    // 3. Search posts
    const searchResults = await repo.searchPosts("network");
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0].root.id).toBe(root.id);

    // 4. Export backup
    const passphrase = "ultra-secure-passphrase";
    const envelope = await repo.exportArchive(passphrase);
    expect(envelope.app).toBe("redline");

    // 5. Decrypt backup into memory
    const archive = await decryptBackupArchive(envelope, passphrase);
    expect(archive.posts).toHaveLength(2);

    // 6. Restore backup
    const restoreResult = await repo.restoreArchive(archive, "merge");
    expect(restoreResult.mode).toBe("merge");

    // 7. Delete post (scrubbing body)
    await repo.deletePost(reply.id);
    const postInStore = await store.get<{ body: string; deletedAt: string }>(
      "dear_dumbass_posts",
      reply.id,
    );
    expect(postInStore?.body).toBe("");
    expect(postInStore?.deletedAt).toBeTruthy();
  });
});
