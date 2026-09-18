import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import MorePage from "./page";
import { MoreRow } from "./more-row";
import { Wallet } from "lucide-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("More Page and MoreRow Responsive Contracts", () => {
  const cssPath = resolve(process.cwd(), "src/app/(workspace)/more/more-page.module.css");
  const cssContent = readFileSync(cssPath, "utf-8");

  describe("MoreRow Component", () => {
    it("renders row without badge when badge prop is omitted", () => {
      const html = renderToStaticMarkup(
        <MoreRow
          href="/inbox"
          icon={Wallet}
          title="Unsorted Bullshit"
          detail="Raw input stays intact. Dito muna."
        />,
      );

      expect(html).toContain("Unsorted Bullshit");
      expect(html).toContain("Raw input stays intact. Dito muna.");
      expect(html).not.toContain("data-has-badge");
      expect(html).not.toContain("rowStatus");
    });

    it("renders row with status badge and data-has-badge attribute when badge prop is provided", () => {
      const html = renderToStaticMarkup(
        <MoreRow
          href="/private"
          icon={Wallet}
          title="None of Your Business"
          detail="Local-only private vault for data that stays off cloud."
          badge="Check back after I stop adding features"
        />,
      );

      expect(html).toContain("None of Your Business");
      expect(html).toContain("Local-only private vault for data that stays off cloud.");
      expect(html).toContain("data-has-badge");
      expect(html).toContain("Check back after I stop adding features");
      expect(html).toContain("rowStatus");
      expect(html).toContain("statusBadge");
    });
  });

  describe("MorePage Full Assembly Audit", () => {
    it("renders all 17 navigation and planned life area rows", () => {
      const html = renderToStaticMarkup(<MorePage />);

      // Secondary Workflows
      expect(html).toContain("Unsorted Bullshit");
      expect(html).toContain("Notes");
      expect(html).toContain("Dear Dumbass");

      // Connections & Integrations
      expect(html).toContain("Calendar Connections");
      expect(html).toContain("Blackboard");
      expect(html).toContain("Notion");

      // Intelligence & Notifications
      expect(html).toContain("AI Settings");
      expect(html).toContain("Notification Preferences");

      // Planned Areas with long badges
      expect(html).toContain("None of Your Business");
      expect(html).toContain("Check back after I stop adding features");
      expect(html).toContain("Lore");
      expect(html).toContain("Awaiting questionable engineering decisions");
      expect(html).toContain("Things to Consume Before I Die");
      expect(html).toContain("Currently somebody else&#x27;s problem");
      expect(html).toContain("Anti-Gastador");
      expect(html).toContain("Soon™");
      expect(html).toContain("These Mfs");
      expect(html).toContain("Gala");
      expect(html).toContain("Football (EFU)");
      expect(html).toContain("Skills");
    });
  });

  describe("CSS Layout Contracts", () => {
    it("configures responsive grid layout for indexRow", () => {
      expect(cssContent).toContain("grid-template-columns: 2.15rem minmax(0, 1fr) auto;");
      expect(cssContent).toContain("grid-template-areas: \"icon content trailing\";");
      expect(cssContent).toContain(".indexRow[data-has-badge]");
    });

    it("places status badge below content on mobile and inline on desktop", () => {
      expect(cssContent).toContain("\"icon content  trailing\"");
      expect(cssContent).toContain("\"icon status   trailing\"");
      expect(cssContent).toContain("@media (min-width: 44rem)");
      expect(cssContent).toContain("grid-template-areas: \"icon content status trailing\";");
    });

    it("ensures status badge and row text wrap naturally by words without character-by-character breaking", () => {
      expect(cssContent).toContain("overflow-wrap: break-word;");
      expect(cssContent).toContain("word-break: normal;");
      expect(cssContent).not.toContain("word-break: break-word;");
    });

    it("allocates sufficient mobile bottom clearance so the final setting card scrolls above the floating dock", () => {
      expect(cssContent).toContain("padding-bottom: max(3rem, calc(env(safe-area-inset-bottom, 0px) + 2.25rem));");
    });
  });
});
