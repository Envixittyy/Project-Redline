import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InMemoryPrivateStore } from "@/services/private-store";
import { DearDumbassRepository, type DearDumbassPost } from "@/services/dear-dumbass";
import { DearDumbassCard, formatRelativeTime } from "./dear-dumbass-card";
import { DearDumbassFeed } from "./dear-dumbass-feed";

describe("Dear Dumbass UI Components", () => {
  const store = new InMemoryPrivateStore();
  const repo = new DearDumbassRepository(store);

  describe("formatRelativeTime", () => {
    it("formats recent timestamps as 'just now'", () => {
      const now = new Date().toISOString();
      expect(formatRelativeTime(now)).toBe("just now");
    });

    it("formats minutes ago", () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(formatRelativeTime(fiveMinAgo)).toBe("5m ago");
    });

    it("formats hours ago", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(twoHoursAgo)).toBe("2h ago");
    });

    it("formats days ago", () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(threeDaysAgo)).toBe("3d ago");
    });
  });

  describe("DearDumbassCard", () => {
    const samplePost: DearDumbassPost = {
      id: "test-post-1",
      body: "FUCK THIS CLASS\nLong rant here.",
      createdAt: new Date().toISOString(),
      updatedAt: null,
      replyToId: null,
      deletedAt: null,
    };

    it("renders post body, formatted timestamp, and action buttons", () => {
      const html = renderToStaticMarkup(
        <DearDumbassCard post={samplePost} repository={repo} />,
      );

      expect(html).toContain("FUCK THIS CLASS");
      expect(html).toContain("Long rant here.");
      expect(html).toContain("Reply");
      expect(html).toContain("Edit");
      expect(html).toContain("Delete");
    });

    it("renders (edited) tag when updatedAt is present", () => {
      const editedPost: DearDumbassPost = {
        ...samplePost,
        updatedAt: new Date().toISOString(),
      };
      const html = renderToStaticMarkup(
        <DearDumbassCard post={editedPost} repository={repo} />,
      );

      expect(html).toContain("(edited)");
    });

    it("renders reply count badge when replyCount > 0", () => {
      const html = renderToStaticMarkup(
        <DearDumbassCard post={samplePost} replyCount={3} repository={repo} />,
      );

      expect(html).toContain("3");
    });

    it("renders reply card without top-level Reply toggle button", () => {
      const replyPost: DearDumbassPost = {
        id: "reply-1",
        body: "I replied to myself",
        createdAt: new Date().toISOString(),
        updatedAt: null,
        replyToId: "test-post-1",
        deletedAt: null,
      };

      const html = renderToStaticMarkup(
        <DearDumbassCard post={replyPost} isReply={true} repository={repo} />,
      );

      expect(html).toContain("I replied to myself");
      expect(html).toContain("Edit");
      expect(html).toContain("Delete");
      // Does not contain root reply toggle button
      expect(html).not.toContain("Reply to post");
    });
  });

  describe("DearDumbassFeed Static Rendering", () => {
    it("renders header, personality subtitle, privacy badge, and composer", () => {
      const html = renderToStaticMarkup(<DearDumbassFeed repository={repo} />);

      expect(html).toContain("Dear Dumbass");
      expect(html).toContain("Population: 1");
      expect(html).toContain("Local Only");
      expect(html).toContain("Scream into the void…");
      expect(html).toContain("Ctrl+Enter to post");
      expect(html).toContain("Post");
    });
  });
});
