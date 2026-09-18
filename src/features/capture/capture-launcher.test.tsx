import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("server-only", () => ({}));

import { CaptureTrigger } from "./capture-launcher";

describe("Universal Capture Launcher Contracts", () => {
  const cssPath = resolve(process.cwd(), "src/features/capture/capture.module.css");
  const cssContent = readFileSync(cssPath, "utf-8");

  it("renders desktop and compact capture triggers", () => {
    const desktopHtml = renderToStaticMarkup(<CaptureTrigger />);
    expect(desktopHtml).toContain("Capture");
    expect(desktopHtml).toContain("Ctrl ⇧ Space");

    const compactHtml = renderToStaticMarkup(<CaptureTrigger compact />);
    expect(compactHtml).toContain("aria-label=\"Open universal capture\"");
  });

  it("defines liquid-glass styles for the Dear Dumbass action row inside capture launcher", () => {
    expect(cssContent).toContain(".launcherActions");
    expect(cssContent).toContain(".launcherDumbassAction");
    expect(cssContent).toContain(".launcherDumbassIcon");
    expect(cssContent).toContain(".launcherDumbassTitle");
    expect(cssContent).toContain(".launcherDumbassSubtitle");
    expect(cssContent).toContain(".launcherDumbassBadge");
  });
});
