import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Sparkles } from "lucide-react";

import { Button, IconButton } from "./button";
import { Input } from "./input";
import { Textarea } from "./textarea";
import { SearchInput } from "./search-input";
import { Checkbox } from "./checkbox";
import { Toggle } from "./toggle";
import { Badge } from "./badge";
import { Surface } from "./surface";
import { SegmentedControl } from "./segmented-control";
import { EmptyState } from "./empty-state";
import { Tooltip } from "./tooltip";

describe("S7 Shared UI Primitives", () => {
  describe("Button", () => {
    it("renders with default secondary variant and md size", () => {
      const html = renderToStaticMarkup(<Button>Click me</Button>);
      expect(html).toContain("Click me");
      expect(html).toContain("button");
      expect(html).toContain("secondary");
      expect(html).toContain("md");
    });

    it("renders primary, ghost, and destructive variants", () => {
      const primary = renderToStaticMarkup(
        <Button variant="primary">Primary</Button>,
      );
      expect(primary).toContain("primary");

      const ghost = renderToStaticMarkup(<Button variant="ghost">Ghost</Button>);
      expect(ghost).toContain("ghost");

      const destructive = renderToStaticMarkup(
        <Button variant="destructive">Delete</Button>,
      );
      expect(destructive).toContain("destructive");
    });

    it("renders loading spinner and disabled state", () => {
      const html = renderToStaticMarkup(<Button loading>Saving</Button>);
      expect(html).toContain("disabled=\"\"");
      expect(html).toContain("aria-busy=\"true\"");
      expect(html).toContain("spinner");
    });

    it("renders icon on left and right correctly", () => {
      const left = renderToStaticMarkup(
        <Button icon={<Sparkles size={16} />}>Magic</Button>,
      );
      expect(left).toContain("Magic");
      expect(left).toContain("<svg");

      const right = renderToStaticMarkup(
        <Button icon={<Sparkles size={16} />} iconPosition="right">
          Magic
        </Button>,
      );
      expect(right).toContain("Magic");
      expect(right).toContain("<svg");
    });

    it("renders IconButton with iconOnly styling and aria-label", () => {
      const html = renderToStaticMarkup(
        <IconButton
          icon={<Sparkles size={16} />}
          aria-label="Sparkle action"
        />,
      );
      expect(html).toContain("iconOnly");
      expect(html).toContain("aria-label=\"Sparkle action\"");
      expect(html).toContain("<svg");
    });
  });

  describe("Form Controls (Input, Textarea, SearchInput)", () => {
    it("renders standard input with placeholder and value", () => {
      const html = renderToStaticMarkup(
        <Input placeholder="Enter title" defaultValue="Test" />,
      );
      expect(html).toContain("placeholder=\"Enter title\"");
      expect(html).toContain("value=\"Test\"");
    });

    it("renders invalid input state with aria-invalid", () => {
      const html = renderToStaticMarkup(<Input invalid />);
      expect(html).toContain("aria-invalid=\"true\"");
      expect(html).toContain("invalid");
    });

    it("renders input with prefix and suffix slots", () => {
      const html = renderToStaticMarkup(
        <Input
          prefixElement={<Sparkles size={16} />}
          suffixElement={<span>kbd</span>}
        />,
      );
      expect(html).toContain("hasPrefix");
      expect(html).toContain("hasSuffix");
      expect(html).toContain("kbd");
    });

    it("renders textarea with invalid and custom rows", () => {
      const html = renderToStaticMarkup(
        <Textarea rows={4} invalid placeholder="Description" />,
      );
      expect(html).toContain("rows=\"4\"");
      expect(html).toContain("aria-invalid=\"true\"");
      expect(html).toContain("placeholder=\"Description\"");
    });

    it("renders SearchInput with search icon and shortcut badge", () => {
      const html = renderToStaticMarkup(
        <SearchInput shortcut="Esc" placeholder="Search tasks…" />,
      );
      expect(html).toContain("type=\"search\"");
      expect(html).toContain("placeholder=\"Search tasks…\"");
      expect(html).toContain("Esc");
    });
  });

  describe("Checkbox & Toggle", () => {
    it("renders unchecked, checked, and disabled checkbox", () => {
      const unchecked = renderToStaticMarkup(<Checkbox label="Remember me" />);
      expect(unchecked).toContain("type=\"checkbox\"");
      expect(unchecked).toContain("Remember me");

      const checked = renderToStaticMarkup(
        <Checkbox checked readOnly label="Remember me" />,
      );
      expect(checked).toContain("boxChecked");

      const disabled = renderToStaticMarkup(
        <Checkbox disabled label="Remember me" />,
      );
      expect(disabled).toContain("disabled=\"\"");
      expect(disabled).toContain("containerDisabled");
    });

    it("renders Toggle switch with role='switch' and accessibility labels", () => {
      const html = renderToStaticMarkup(
        <Toggle
          label="Push notifications"
          description="Receive real-time alerts"
          checked
          readOnly
        />,
      );
      expect(html).toContain("role=\"switch\"");
      expect(html).toContain("aria-checked=\"true\"");
      expect(html).toContain("Push notifications");
      expect(html).toContain("Receive real-time alerts");
      expect(html).toContain("track");
      expect(html).toContain("thumb");
    });
  });

  describe("Badge & Status Indicator", () => {
    it("renders semantic tones (neutral, info, success, warning, destructive, accent)", () => {
      const info = renderToStaticMarkup(<Badge tone="info">Active</Badge>);
      expect(info).toContain("info");
      expect(info).toContain("Active");

      const success = renderToStaticMarkup(
        <Badge tone="success">Completed</Badge>,
      );
      expect(success).toContain("success");

      const warning = renderToStaticMarkup(
        <Badge tone="warning">Pending</Badge>,
      );
      expect(warning).toContain("warning");

      const destructive = renderToStaticMarkup(
        <Badge tone="destructive">Overdue</Badge>,
      );
      expect(destructive).toContain("destructive");

      const accent = renderToStaticMarkup(<Badge tone="accent">Redline</Badge>);
      expect(accent).toContain("accent");
    });

    it("renders course tone with custom course color and dot", () => {
      const html = renderToStaticMarkup(
        <Badge tone="course" courseColor="#2563eb" dot>
          CS 101
        </Badge>,
      );
      expect(html).toContain("course");
      expect(html).toContain("--course-color:#2563eb");
      expect(html).toContain("dot");
      expect(html).toContain("CS 101");
    });

    it("renders outline and solid variants", () => {
      const outline = renderToStaticMarkup(
        <Badge variant="outline" tone="success">
          Outline
        </Badge>,
      );
      expect(outline).toContain("outline");

      const solid = renderToStaticMarkup(
        <Badge variant="solid" tone="destructive">
          Solid
        </Badge>,
      );
      expect(solid).toContain("solid");
    });
  });

  describe("Surface Hierarchy", () => {
    it("renders base, subtle, interactive, elevated, and glass surfaces", () => {
      const base = renderToStaticMarkup(<Surface variant="base">Base</Surface>);
      expect(base).toContain("base");

      const subtle = renderToStaticMarkup(
        <Surface variant="subtle">Subtle</Surface>,
      );
      expect(subtle).toContain("subtle");

      const interactive = renderToStaticMarkup(
        <Surface variant="interactive">Click</Surface>,
      );
      expect(interactive).toContain("interactive");
      expect(interactive).toContain("motion-interactive");

      const elevated = renderToStaticMarkup(
        <Surface variant="elevated">Elevated</Surface>,
      );
      expect(elevated).toContain("elevated");

      const glass = renderToStaticMarkup(
        <Surface variant="glass">Glass</Surface>,
      );
      expect(glass).toContain("glass");
    });

    it("supports padding presets and polymorphic as tag", () => {
      const html = renderToStaticMarkup(
        <Surface as="section" padding="lg">
          Section Content
        </Surface>,
      );
      expect(html).toContain("<section");
      expect(html).toContain("padLg");
      expect(html).toContain("Section Content");
    });
  });

  describe("SegmentedControl", () => {
    const options = [
      { value: "day", label: "Day" },
      { value: "week", label: "Week" },
      { value: "month", label: "Month" },
    ];

    it("renders all segments with radio roles and selected indicator", () => {
      const html = renderToStaticMarkup(
        <SegmentedControl
          options={options}
          value="week"
          onChange={() => {}}
          ariaLabel="Calendar View"
        />,
      );
      expect(html).toContain("role=\"radiogroup\"");
      expect(html).toContain("aria-label=\"Calendar View\"");
      expect(html).toContain("aria-checked=\"true\"");
      expect(html).toContain("segmentActive");
      expect(html).toContain("Day");
      expect(html).toContain("Week");
      expect(html).toContain("Month");
    });
  });

  describe("EmptyState", () => {
    it("renders title, description, icon and action", () => {
      const html = renderToStaticMarkup(
        <EmptyState
          icon={<Sparkles size={24} />}
          title="No items yet"
          description="Create your first item to get started."
          action={<Button variant="primary">Create Item</Button>}
        />,
      );
      expect(html).toContain("No items yet");
      expect(html).toContain("Create your first item to get started.");
      expect(html).toContain("<svg");
      expect(html).toContain("Create Item");
    });
  });

  describe("Tooltip", () => {
    it("renders children wrapped with tooltip container", () => {
      const html = renderToStaticMarkup(
        <Tooltip content="Helper text">
          <button type="button">Hover me</button>
        </Tooltip>,
      );
      expect(html).toContain("Hover me");
    });
  });
});
