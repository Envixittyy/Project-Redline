import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlannedAreaPage } from "./planned-area-page";
import { PlannedAreaIllustration, type IllustrationType } from "./planned-area-illustrations";
import { copy } from "@/lib/copy";
import { isActiveRoute, plannedAreaRoutes } from "@/lib/navigation";

describe("Planned Areas Experience", () => {
  describe("copy dictionary completeness", () => {
    const requiredAreas = [
      "antiGastador",
      "soon",
      "media",
      "journal",
      "lore",
      "people",
      "gala",
      "football",
      "skills",
      "privateData",
    ] as const;

    it("defines all 10 planned areas with valid configurations", () => {
      for (const key of requiredAreas) {
        const area = copy.plannedAreas[key];
        expect(area).toBeDefined();
        expect(area.name).toBeTruthy();
        expect(area.route).toMatch(/^\/[a-z0-9-]+$/);
        expect(area.status).toBeTruthy();
        expect(area.headline).toBeTruthy();
        expect(area.description).toBeTruthy();
        expect(area.summary).toBeTruthy();
        expect(area.capabilities.length).toBeGreaterThanOrEqual(3);
        expect(area.illustration).toBeTruthy();
      }
    });

    it("verifies privacy notice for privateData is phrased as planned, not active", () => {
      const privateArea = copy.plannedAreas.privateData;
      expect(privateArea.privacyNotice).toBeDefined();
      expect(privateArea.privacyNotice).toContain("Planned private data");
      expect(privateArea.privacyNotice).toContain("will not be stored in Adulting.exe's cloud services");
    });

    it("verifies headlines are static and stable", () => {
      expect(copy.plannedAreas.antiGastador.headline).toBe(
        "Financial responsibility is still under construction.",
      );
      expect(copy.plannedAreas.soon.headline).toBe(
        "Soon™ is, unfortunately, living up to its name.",
      );
      expect(copy.plannedAreas.media.headline).toBe(
        "The backlog already exists. The interface is catching up.",
      );
      expect(copy.plannedAreas.journal.headline).toBe(
        "I have thoughts. The app doesn't. Yet.",
      );
      expect(copy.plannedAreas.lore.headline).toBe(
        "Your lore is still compiling.",
      );
      expect(copy.plannedAreas.people.headline).toBe(
        "I do, in fact, know people.",
      );
      expect(copy.plannedAreas.gala.headline).toBe(
        "Currently traveling to the implementation phase.",
      );
      expect(copy.plannedAreas.football.headline).toBe(
        "The football department has no software yet.",
      );
      expect(copy.plannedAreas.skills.headline).toBe(
        "Skill issue. Literally.",
      );
      expect(copy.plannedAreas.privateData.headline).toBe(
        "Your digital hoard deserves proper shelving.",
      );
    });
  });

function normalizeHtml(html: string): string {
  return html
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&ldquo;", '"')
    .replaceAll("&rdquo;", '"')
    .replaceAll("&apos;", "'");
}

  describe("PlannedAreaPage rendering", () => {
    it("renders core elements: title, headline, description, badge, and back link", () => {
      const area = copy.plannedAreas.soon;
      const html = normalizeHtml(renderToStaticMarkup(<PlannedAreaPage {...area} />));

      expect(html).toContain(area.name);
      expect(html).toContain(area.headline);
      expect(html).toContain(area.description);
      expect(html).toContain(area.status);
      expect(html).toContain("PLANNED AREA");
      expect(html).toContain("Back to More");
      expect(html).toContain('href="/more"');

      // Check capabilities
      for (const cap of area.capabilities) {
        expect(html).toContain(cap);
      }
    });

    it("renders privacy disclosure box when privacyNotice is present", () => {
      const area = copy.plannedAreas.privateData;
      const html = normalizeHtml(renderToStaticMarkup(<PlannedAreaPage {...area} />));

      expect(html).toContain(area.privacyNotice!);
      expect(html).toContain('aria-label="Privacy disclosure"');
    });

    it("renders secondary footer note when present", () => {
      const area = copy.plannedAreas.antiGastador;
      const html = normalizeHtml(renderToStaticMarkup(<PlannedAreaPage {...area} />));

      expect(html).toContain(area.secondaryNote!);
    });
  });

  describe("PlannedAreaIllustration component", () => {
    const illustrationTypes: IllustrationType[] = [
      "anti-gastador",
      "soon",
      "consume",
      "dear-dumbass",
      "lore",
      "people",
      "gala",
      "football",
      "skills",
      "private",
    ];

    it("renders all 10 distinct illustrations with aria-hidden for accessibility", () => {
      for (const type of illustrationTypes) {
        const html = renderToStaticMarkup(<PlannedAreaIllustration type={type} />);
        expect(html).toContain('aria-hidden="true"');
      }
    });

    it("renders specific thematic elements inside respective illustrations", () => {
      const antiHtml = renderToStaticMarkup(<PlannedAreaIllustration type="anti-gastador" />);
      expect(antiHtml).toContain("SURVIVAL BUDGET");
      expect(antiHtml).toContain("₱ 450.00");

      const soonHtml = renderToStaticMarkup(<PlannedAreaIllustration type="soon" />);
      expect(soonHtml).toContain("Stuck at 93%");

      const loreHtml = renderToStaticMarkup(<PlannedAreaIllustration type="lore" />);
      expect(loreHtml).toContain("THE INCIDENT");

      const privateHtml = renderToStaticMarkup(<PlannedAreaIllustration type="private" />);
      expect(privateHtml).toContain("127.0.0.1 ONLY");
    });
  });

  describe("Navigation integration", () => {
    it("recognizes all planned area routes as active under /more", () => {
      for (const route of plannedAreaRoutes) {
        expect(isActiveRoute(route, "/more")).toBe(true);
      }
    });

    it("does not falsely match planned area routes to other tabs", () => {
      for (const route of plannedAreaRoutes) {
        expect(isActiveRoute(route, "/")).toBe(false);
        expect(isActiveRoute(route, "/tasks")).toBe(false);
        expect(isActiveRoute(route, "/calendar")).toBe(false);
        expect(isActiveRoute(route, "/school")).toBe(false);
      }
    });
  });
});
