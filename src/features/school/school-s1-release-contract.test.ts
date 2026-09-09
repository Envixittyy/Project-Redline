import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const file = (path: string) => readFileSync(path, "utf8");

describe("Phase S1 School release UI contract", () => {
  it("keeps S1 email active while exposing S2 calendar observation without apply controls", () => {
    const integrationPage = file("src/app/(workspace)/integrations/blackboard/page.tsx");
    const integrationPanel = file("src/features/integrations/blackboard-panel.tsx");
    const morePage = file("src/app/(workspace)/more/page.tsx");
    const commandPalette = file("src/components/shell/command-palette.tsx");

    expect(integrationPage).toContain("BlackboardPanel");
    expect(integrationPage).toContain("getBlackboardStatus");
    expect(integrationPage).toContain("S1 notification-email ingestion");
    expect(integrationPanel).toContain("Calendar sync starts in observe mode");
    expect(integrationPanel).not.toContain("Enable apply");
    expect(morePage).not.toContain("Secure calendar sync");
    expect(commandPalette).not.toContain("Review secure calendar sync");
  });

  it("keeps School activity course presentation on the canonical persisted relationship", () => {
    const activity = file("src/features/school/school-activity-feed.tsx");
    const detail = file("src/features/school/school-course-detail.tsx");

    expect(activity).toContain("findSchoolEventCourse(event, courses)");
    expect(detail).toContain("schoolEventBelongsToCourse(event, course.id)");
    expect(activity).not.toMatch(/courseHint[\s\S]{0,160}c\.code/);
    expect(detail).not.toMatch(/courseKey\?\.includes/);
  });
});
