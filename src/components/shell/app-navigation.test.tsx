import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { isActiveRoute, mobileNavigation, primaryNavigation, secondaryNavigation } from "@/lib/navigation";
import { DesktopNavigation, MobileTabBar } from "./app-navigation";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
}));

describe("S7C Navigation Architecture", () => {
  describe("isActiveRoute path matching", () => {
    it("matches root path strictly when on root", () => {
      expect(isActiveRoute("/", "/")).toBe(true);
      expect(isActiveRoute("/tasks", "/")).toBe(false);
      expect(isActiveRoute("/calendar", "/")).toBe(false);
    });

    it("matches exact section paths", () => {
      expect(isActiveRoute("/tasks", "/tasks")).toBe(true);
      expect(isActiveRoute("/calendar", "/calendar")).toBe(true);
      expect(isActiveRoute("/school", "/school")).toBe(true);
      expect(isActiveRoute("/notes", "/notes")).toBe(true);
      expect(isActiveRoute("/inbox", "/inbox")).toBe(true);
      expect(isActiveRoute("/more", "/more")).toBe(true);
    });

    it("matches nested subroutes without false positives", () => {
      expect(isActiveRoute("/tasks/123", "/tasks")).toBe(true);
      expect(isActiveRoute("/school/cs101", "/school")).toBe(true);
      expect(isActiveRoute("/settings/ai", "/more")).toBe(true);
      expect(isActiveRoute("/settings/notifications", "/more")).toBe(true);
      expect(isActiveRoute("/integrations/calendars", "/more")).toBe(true);
      expect(isActiveRoute("/integrations/blackboard", "/more")).toBe(true);
      expect(isActiveRoute("/integrations/notion", "/more")).toBe(true);
      expect(isActiveRoute("/tasks-archive", "/tasks")).toBe(false);
      expect(isActiveRoute("/schoolyard", "/school")).toBe(false);
    });

    it("ignores query strings and hash anchors", () => {
      expect(isActiveRoute("/tasks?view=today", "/tasks")).toBe(true);
      expect(isActiveRoute("/more#appearance", "/more")).toBe(true);
      expect(isActiveRoute("/calendar?month=2026-09", "/calendar")).toBe(true);
    });
  });

  describe("DesktopNavigation", () => {
    it("renders all primary destinations", () => {
      const html = renderToStaticMarkup(<DesktopNavigation />);
      for (const item of primaryNavigation) {
        expect(html).toContain(item.label);
        expect(html).toContain(`href="${item.href}"`);
      }
    });

    it("renders secondary workspace destinations and section title", () => {
      const html = renderToStaticMarkup(<DesktopNavigation />);
      expect(html).toContain("Workspace");
      for (const item of secondaryNavigation) {
        expect(html).toContain(item.label);
        expect(html).toContain(`href="${item.href}"`);
      }
    });

    it("renders More destination", () => {
      const html = renderToStaticMarkup(<DesktopNavigation />);
      expect(html).toContain("More");
      expect(html).toContain('href="/more"');
    });

    it("marks the active route with aria-current='page' and data-active", () => {
      // Mocked path is "/tasks"
      const html = renderToStaticMarkup(<DesktopNavigation />);
      expect(html).toContain('aria-current="page"');
      expect(html).toContain('data-active="true"');
      expect(html).toContain('href="/tasks"');
    });
  });

  describe("MobileTabBar", () => {
    it("renders the 5 mobile persistent destinations", () => {
      const html = renderToStaticMarkup(<MobileTabBar />);
      expect(mobileNavigation).toHaveLength(5);
      for (const item of mobileNavigation) {
        expect(html).toContain(item.label);
        expect(html).toContain(`href="${item.href}"`);
      }
    });

    it("marks the active mobile tab with aria-current='page'", () => {
      const html = renderToStaticMarkup(<MobileTabBar />);
      expect(html).toContain('aria-current="page"');
      expect(html).toContain('data-active="true"');
    });
  });
});
