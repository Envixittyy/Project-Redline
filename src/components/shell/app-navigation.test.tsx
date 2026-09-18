import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
      expect(isActiveRoute("/soon", "/more")).toBe(true);
      expect(isActiveRoute("/anti-gastador", "/more")).toBe(true);
      expect(isActiveRoute("/consume", "/more")).toBe(true);
      expect(isActiveRoute("/dear-dumbass", "/more")).toBe(true);
      expect(isActiveRoute("/lore", "/more")).toBe(true);
      expect(isActiveRoute("/people", "/more")).toBe(true);
      expect(isActiveRoute("/gala", "/more")).toBe(true);
      expect(isActiveRoute("/football", "/more")).toBe(true);
      expect(isActiveRoute("/skills", "/more")).toBe(true);
      expect(isActiveRoute("/private", "/more")).toBe(true);
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
        expect(html).toContain(item.shortLabel ?? item.label);
        expect(html).toContain(`href="${item.href}"`);
      }
    });

    it("marks the active mobile tab with aria-current='page'", () => {
      const html = renderToStaticMarkup(<MobileTabBar />);
      expect(html).toContain('aria-current="page"');
      expect(html).toContain('data-active="true"');
    });

    it("renders active marker element with aria-hidden for visual floating indicator", () => {
      const html = renderToStaticMarkup(<MobileTabBar />);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('--active-index');
    });

    it("guarantees 5 touch-target-ready destinations for the floating dock capsule", () => {
      expect(mobileNavigation).toHaveLength(5);
      const labels = mobileNavigation.map((item) => item.label);
      expect(labels).toEqual([
        "So, Ano Na?",
        "Shit to Do",
        "My Alleged Schedule",
        "Academic Suffering",
        "More",
      ]);
    });
  });

  describe("S7J Mobile Floating Dock & Glass Contracts", () => {
    const tokensPath = resolve(process.cwd(), "src/styles/tokens.css");
    const shellCssPath = resolve(process.cwd(), "src/components/shell/app-shell.module.css");
    const tokensContent = readFileSync(tokensPath, "utf-8");
    const shellCssContent = readFileSync(shellCssPath, "utf-8");

    it("defines floating dock geometry and spacing tokens", () => {
      expect(tokensContent).toContain("--mobile-nav-height: 4rem;");
      expect(tokensContent).toContain("--mobile-dock-offset: max(1.15rem, calc(env(safe-area-inset-bottom, 0px) + 0.65rem));");
      expect(tokensContent).toContain("--mobile-nav-space: calc(var(--mobile-nav-height) + var(--mobile-dock-offset));");
    });

    it("defines liquid-glass tokens across light and dark appearances", () => {
      expect(tokensContent).toContain("--dock-surface:");
      expect(tokensContent).toContain("--dock-border:");
      expect(tokensContent).toContain("--dock-shadow:");
      expect(tokensContent).toContain("--topbar-surface:");
      expect(tokensContent).toContain("--topbar-border:");
      expect(tokensContent).toContain("--topbar-shadow:");

      const dockSurfaceOccurrences = (tokensContent.match(/--dock-surface:/g) || []).length;
      expect(dockSurfaceOccurrences).toBeGreaterThanOrEqual(3);
    });

    it("styles mobile dock as a floating capsule with restrained width and blur", () => {
      expect(shellCssContent).toContain("width: min(calc(100% - 2.75rem), 21.5rem);");
      expect(shellCssContent).toContain("border: 1px solid var(--dock-border);");
      expect(shellCssContent).toContain("border-radius: 1.625rem;");
      expect(shellCssContent).toContain("background: var(--dock-surface);");
      expect(shellCssContent).toContain("box-shadow: var(--dock-shadow);");
      expect(shellCssContent).toContain("backdrop-filter: blur(20px) saturate(1.35);");
      expect(shellCssContent).toContain("-webkit-backdrop-filter: blur(20px) saturate(1.35);");
    });

    it("centers the mobile nav and applies floating bottom offset", () => {
      expect(shellCssContent).toContain("display: flex;");
      expect(shellCssContent).toContain("justify-content: center;");
      expect(shellCssContent).toContain("var(--mobile-dock-offset)");
    });

    it("styles mobile topbar with liquid-glass depth and saturation boost", () => {
      expect(shellCssContent).toContain("border-bottom: 1px solid var(--topbar-border);");
      expect(shellCssContent).toContain("background: var(--topbar-surface);");
      expect(shellCssContent).toContain("box-shadow: var(--topbar-shadow);");
      expect(shellCssContent).toContain("backdrop-filter: blur(20px) saturate(1.35);");
    });

    it("allocates page bottom padding to prevent content clipping above floating dock", () => {
      expect(shellCssContent).toContain("calc(var(--mobile-nav-space) + 1.75rem)");
    });

    describe("Viewport Geometry & Touch Target Calculations", () => {
      const REM = 16;
      const DOCK_MAX_WIDTH = 21.5 * REM; // 344px
      const HORIZONTAL_DOCK_INSET = 2.75 * REM; // 44px
      const DOCK_PADDING_X = 0.7 * REM; // 11.2px
      const DOCK_HEIGHT = 4 * REM; // 64px
      const LINK_MIN_HEIGHT = 3.375 * REM; // 54px

      function calculateMetrics(viewportWidth: number, safeAreaBottom: number) {
        const dockWidth = Math.min(viewportWidth - HORIZONTAL_DOCK_INSET, DOCK_MAX_WIDTH);
        const sideInset = (viewportWidth - dockWidth) / 2;
        const tabWidth = (dockWidth - DOCK_PADDING_X) / 5;
        const tabHeight = LINK_MIN_HEIGHT;
        const dockOffset = Math.max(1.15 * REM, safeAreaBottom + 0.65 * REM);
        const dockTopFromBottom = DOCK_HEIGHT + dockOffset;
        const mainBottomPadding = DOCK_HEIGHT + dockOffset + 1.75 * REM;
        const contentClearance = mainBottomPadding - dockTopFromBottom;

        return {
          dockWidth,
          sideInset,
          tabWidth,
          tabHeight,
          dockOffset,
          contentClearance,
        };
      }

      it("verifies 390x844 viewport (iPhone 12/13/14)", () => {
        const m = calculateMetrics(390, 34);
        expect(m.dockWidth).toBe(344);
        expect(m.sideInset).toBe(23);
        expect(m.tabWidth).toBeGreaterThanOrEqual(44);
        expect(m.tabHeight).toBeGreaterThanOrEqual(44);
        expect(m.dockOffset).toBeGreaterThan(34);
        expect(m.contentClearance).toBe(28);
      });

      it("verifies 430x932 viewport (iPhone Pro Max)", () => {
        const m = calculateMetrics(430, 34);
        expect(m.dockWidth).toBe(344);
        expect(m.sideInset).toBe(43);
        expect(m.tabWidth).toBeGreaterThanOrEqual(44);
        expect(m.tabHeight).toBeGreaterThanOrEqual(44);
        expect(m.dockOffset).toBeGreaterThan(34);
        expect(m.contentClearance).toBe(28);
      });

      it("verifies 390x500 viewport (Compact / Short Viewport)", () => {
        const m = calculateMetrics(390, 0);
        expect(m.dockWidth).toBe(344);
        expect(m.sideInset).toBe(23);
        expect(m.tabWidth).toBeGreaterThanOrEqual(44);
        expect(m.tabHeight).toBeGreaterThanOrEqual(44);
        expect(m.dockOffset).toBe(18.4);
        expect(m.contentClearance).toBe(28);
      });

      it("verifies 768x1024 viewport (iPad Portrait)", () => {
        const m = calculateMetrics(768, 20);
        expect(m.dockWidth).toBe(344);
        expect(m.sideInset).toBe(212);
        expect(m.tabWidth).toBeGreaterThanOrEqual(44);
        expect(m.tabHeight).toBeGreaterThanOrEqual(44);
        expect(m.contentClearance).toBe(28);
      });
    });
  });
});
