import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { InMemoryPrivateStore } from "@/services/private-store";
import {
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

  it("1. guarantees zero Supabase imports outside cloud-client.ts, and zero cloud queue or remote integration imports", () => {
    const allSourceFiles = targetDirs.flatMap((dir) => getSourceFiles(dir));
    expect(allSourceFiles.length).toBeGreaterThan(0);

    const forbiddenGlobalPatterns = [
      /@\/services\/integrations/,
      /@\/lib\/offline\/queue/,
      /useSearchParams/,
      /next\/headers/,
      /next\/server/,
    ];

    for (const filePath of allSourceFiles) {
      const fileName = path.basename(filePath);
      const content = fs.readFileSync(filePath, "utf-8");

      for (const pattern of forbiddenGlobalPatterns) {
        expect(
          pattern.test(content),
          `Forbidden import pattern ${pattern} found in ${fileName}`,
        ).toBe(false);
      }

      // Supabase is forbidden everywhere EXCEPT cloud-client.ts
      if (fileName !== "cloud-client.ts") {
        expect(
          /@\/services\/supabase/.test(content),
          `Direct Supabase import forbidden in ${fileName}. Only cloud-client.ts may import Supabase for E2EE ciphertext.`,
        ).toBe(false);
      }
    }

    // Explicit contract on cloud-client.ts: must never reference plaintext, body, replyToId, passphrase, or masterKey
    const cloudClientPath = path.resolve(
      process.cwd(),
      "src/services/dear-dumbass/sync/cloud-client.ts",
    );
    const cloudClientContent = fs.readFileSync(cloudClientPath, "utf-8");
    const forbiddenCloudClientPatterns = [
      /\bbody\b/i,
      /\breplyToId\b/i,
      /\bpassphrase\b/i,
      /\bmasterKey\b/i,
      /\bplaintext\b/i,
    ];
    for (const pattern of forbiddenCloudClientPatterns) {
      expect(
        pattern.test(cloudClientContent),
        `Forbidden sensitive field ${pattern} found in cloud-client.ts`,
      ).toBe(false);
    }

    // Explicit contract on Supabase migration: must never define columns for plaintext bodies, replies, or search terms
    const migrationPath = path.resolve(
      process.cwd(),
      "supabase/migrations/20260919100000_dear_dumbass_e2ee_sync.sql",
    );
    const migrationCode = fs
      .readFileSync(migrationPath, "utf-8")
      .replace(/--.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    const forbiddenMigrationPatterns = [
      /\bbody\b/i,
      /\breply_to_id\b/i,
      /\bplaintext\b/i,
      /\bsearch_term\b/i,
      /\btitle\b/i,
    ];
    for (const pattern of forbiddenMigrationPatterns) {
      expect(
        pattern.test(migrationCode),
        `Forbidden plaintext schema column ${pattern} found in migration schema definition`,
      ).toBe(false);
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
