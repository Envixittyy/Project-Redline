import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  desktopNavigationGroups,
  isActiveRoute,
  mobileNavigation,
  plannedAreaRoutes,
} from "@/lib/navigation";
import { DesktopNavigation, MobileTabBar } from "./app-navigation";

// Mock next/navigation with dynamic pathname support
const mockUsePathname = vi.fn(() => "/tasks");
vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
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

    it("differentiates desktop context where planned areas have direct sidebar links", () => {
      for (const route of plannedAreaRoutes) {
        expect(isActiveRoute(route, "/more", false, { isDesktop: true })).toBe(false);
        expect(isActiveRoute(route, route, false, { isDesktop: true })).toBe(true);
      }
      expect(isActiveRoute("/settings/ai", "/more", false, { isDesktop: true })).toBe(true);
      expect(isActiveRoute("/settings/notifications", "/more", false, { isDesktop: true })).toBe(true);
      expect(isActiveRoute("/integrations/calendars", "/more", false, { isDesktop: true })).toBe(true);
      expect(isActiveRoute("/integrations/blackboard", "/more", false, { isDesktop: true })).toBe(true);
      expect(isActiveRoute("/more", "/more", false, { isDesktop: true })).toBe(true);
    });

    it("ignores query strings and hash anchors", () => {
      expect(isActiveRoute("/tasks?view=today", "/tasks")).toBe(true);
      expect(isActiveRoute("/more#appearance", "/more")).toBe(true);
      expect(isActiveRoute("/calendar?month=2026-09", "/calendar")).toBe(true);
    });
  });

  describe("DesktopNavigation", () => {
    it("renders all 4 desktop navigation groups with section titles", () => {
      mockUsePathname.mockReturnValue("/tasks");
      const html = renderToStaticMarkup(<DesktopNavigation />);
      expect(html).toContain("Core");
      expect(html).toContain("My Stuff");
      expect(html).toContain("Life, Apparently");
      expect(html).toContain("Other Shit");
    });

    it("ensures every desktop item in navigation groups has correct href and label", () => {
      mockUsePathname.mockReturnValue("/tasks");
      const html = renderToStaticMarkup(<DesktopNavigation />);
      for (const group of desktopNavigationGroups) {
        for (const item of group.items) {
          expect(html).toContain(`href="${item.href}"`);
          expect(html).toContain(item.label);
        }
      }
    });

    it("exposes /focus directly on desktop as 'Lock In mofo'", () => {
      mockUsePathname.mockReturnValue("/tasks");
      const html = renderToStaticMarkup(<DesktopNavigation />);
      expect(html).toContain('href="/focus"');
      expect(html).toContain("Lock In mofo");
    });

    it("renders every planned area route on desktop with correct href and label", () => {
      mockUsePathname.mockReturnValue("/tasks");
      const html = renderToStaticMarkup(<DesktopNavigation />);
      const expectedPlanned = [
        { href: "/anti-gastador", label: "Anti-Gastador" },
        { href: "/soon", label: "Soon™" },
        { href: "/consume", label: "Things to Consume Before I Die" },
        { href: "/dear-dumbass", label: "Dear Dumbass" },
        { href: "/lore", label: "Lore" },
        { href: "/people", label: "These Mfs" },
        { href: "/gala", label: "Gala" },
        { href: "/football", label: "Football" },
        { href: "/skills", label: "Skills" },
        { href: "/private", label: "None of Your Business" },
      ];

      for (const planned of expectedPlanned) {
        expect(html).toContain(`href="${planned.href}"`);
        expect(html).toContain(planned.label);
      }
    });

    it("exposes WIP indicator and accessible description for planned items only", () => {
      mockUsePathname.mockReturnValue("/tasks");
      const html = renderToStaticMarkup(<DesktopNavigation />);

      // Planned items have WIP text and accessible indicator
      expect(html).toContain("WIP");
      expect(html).toContain("Work in progress");

      // Count WIP indicators matches planned item count (10)
      const wipOccurrences = (html.match(/title="Work in progress \(planned\)"/g) || []).length;
      expect(wipOccurrences).toBe(10);
      expect(plannedAreaRoutes).toHaveLength(10);
    });

    it("renders More destination in desktop navigation footer", () => {
      mockUsePathname.mockReturnValue("/tasks");
      const html = renderToStaticMarkup(<DesktopNavigation />);
      expect(html).toContain("More");
      expect(html).toContain('href="/more"');
    });

    it("marks the active route with aria-current='page' and data-active for planned routes", () => {
      mockUsePathname.mockReturnValue("/soon");
      const html = renderToStaticMarkup(<DesktopNavigation />);
      const soonTag = html.match(/<a[^>]*href="\/soon"[^>]*>/)?.[0] ?? "";
      expect(soonTag).toContain('data-active="true"');
      expect(soonTag).toContain('aria-current="page"');

      // On desktop, More should NOT be active when on /soon
      const moreTag = html.match(/<a[^>]*href="\/more"[^>]*>/)?.[0] ?? "";
      expect(moreTag).not.toContain('data-active="true"');
    });

    it("marks the active route for /focus on desktop", () => {
      mockUsePathname.mockReturnValue("/focus");
      const html = renderToStaticMarkup(<DesktopNavigation />);
      const focusTag = html.match(/<a[^>]*href="\/focus"[^>]*>/)?.[0] ?? "";
      expect(focusTag).toContain('data-active="true"');
      expect(focusTag).toContain('aria-current="page"');
    });

    it("keeps More active for settings and integrations destinations on desktop", () => {
      mockUsePathname.mockReturnValue("/settings/ai");
      let html = renderToStaticMarkup(<DesktopNavigation />);
      let moreTag = html.match(/<a[^>]*href="\/more"[^>]*>/)?.[0] ?? "";
      expect(moreTag).toContain('data-active="true"');

      mockUsePathname.mockReturnValue("/integrations/blackboard");
      html = renderToStaticMarkup(<DesktopNavigation />);
      moreTag = html.match(/<a[^>]*href="\/more"[^>]*>/)?.[0] ?? "";
      expect(moreTag).toContain('data-active="true"');

      mockUsePathname.mockReturnValue("/more");
      html = renderToStaticMarkup(<DesktopNavigation />);
      moreTag = html.match(/<a[^>]*href="\/more"[^>]*>/)?.[0] ?? "";
      expect(moreTag).toContain('data-active="true"');
      expect(moreTag).toContain('aria-current="page"');
    });
  });

  describe("MobileTabBar", () => {
    it("renders the 5 mobile persistent destinations", () => {
      mockUsePathname.mockReturnValue("/tasks");
      const html = renderToStaticMarkup(<MobileTabBar />);
      expect(mobileNavigation).toHaveLength(5);
      for (const item of mobileNavigation) {
        expect(html).toContain(item.shortLabel ?? item.label);
        expect(html).toContain(`href="${item.href}"`);
      }
    });

    it("marks the active mobile tab with aria-current='page'", () => {
      mockUsePathname.mockReturnValue("/tasks");
      const html = renderToStaticMarkup(<MobileTabBar />);
      expect(html).toContain('aria-current="page"');
      expect(html).toContain('data-active="true"');
    });

    it("renders active marker element with aria-hidden for visual floating indicator", () => {
      mockUsePathname.mockReturnValue("/tasks");
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

    it("preserves strictly 5 mobile destinations and has NOT expanded to desktop routes", () => {
      expect(mobileNavigation).toHaveLength(5);
      const mobileHrefs = mobileNavigation.map((item) => item.href);
      expect(mobileHrefs).toEqual([
        "/",
        "/tasks",
        "/calendar",
        "/school",
        "/more",
      ]);

      // Verify planned routes and new desktop destinations are NOT on mobile tab bar
      expect(mobileHrefs).not.toContain("/focus");
      for (const route of plannedAreaRoutes) {
        expect(mobileHrefs).not.toContain(route);
      }
    });

    it("maintains planned route awareness under /more on mobile", () => {
      for (const route of plannedAreaRoutes) {
        expect(isActiveRoute(route, "/more")).toBe(true);
        expect(isActiveRoute(route, "/more", false, { isDesktop: false })).toBe(true);
      }
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
