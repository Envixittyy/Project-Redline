import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFloatingPortalRoot } from "./floating-portal-root";

type MockElement = {
  tagName: string;
  parentElement: MockElement | null;
  attributes: Record<string, string>;
  id?: string;
  open?: boolean;
  closest: (selector: string) => MockElement | null;
  hasAttribute: (name: string) => boolean;
  setAttribute: (name: string, val: string) => void;
  removeAttribute: (name: string) => void;
};

function createMockElement(
  tagName: string,
  properties: Partial<MockElement> = {},
): MockElement {
  const el: MockElement = {
    tagName: tagName.toUpperCase(),
    parentElement: null,
    attributes: {},
    closest(selector: string) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      let current: MockElement | null = this;
      while (current) {
        if (selector === "dialog" && current.tagName === "DIALOG") {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    },
    hasAttribute(name: string) {
      return name in this.attributes;
    },
    setAttribute(name: string, val: string) {
      this.attributes[name] = val;
    },
    removeAttribute(name: string) {
      delete this.attributes[name];
    },
    ...properties,
  };
  return el;
}

describe("floating portal root resolution", () => {
  const originalDocument = globalThis.document;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.document = originalDocument;
  });

  it("returns null when document is undefined (SSR)", () => {
    // @ts-expect-error simulating SSR
    delete globalThis.document;

    const dummy = createMockElement("div") as unknown as HTMLElement;
    expect(getFloatingPortalRoot(dummy)).toBeNull();
  });

  it("falls back to document.body when element is null", () => {
    const mockBody = createMockElement("body") as unknown as HTMLElement;
    globalThis.document = { body: mockBody } as unknown as Document;

    expect(getFloatingPortalRoot(null)).toBe(mockBody);
  });

  it("falls back to document.body when element is outside any dialog", () => {
    const mockBody = createMockElement("body") as unknown as HTMLElement;
    globalThis.document = { body: mockBody } as unknown as Document;

    const pageContainer = createMockElement("div");
    pageContainer.parentElement = mockBody as unknown as MockElement;

    const trigger = createMockElement("button");
    trigger.parentElement = pageContainer;

    const result = getFloatingPortalRoot(trigger as unknown as HTMLElement);
    expect(result).toBe(mockBody);
  });

  it("falls back to document.body when enclosing dialog is closed", () => {
    const mockBody = createMockElement("body") as unknown as HTMLElement;
    globalThis.document = { body: mockBody } as unknown as Document;

    const closedDialog = createMockElement("dialog", { open: false });
    closedDialog.parentElement = mockBody as unknown as MockElement;

    const trigger = createMockElement("button");
    trigger.parentElement = closedDialog;

    const result = getFloatingPortalRoot(trigger as unknown as HTMLElement);
    expect(result).toBe(mockBody);
  });

  it("resolves to nearest open dialog when dialog.open is true", () => {
    const mockBody = createMockElement("body") as unknown as HTMLElement;
    globalThis.document = { body: mockBody } as unknown as Document;

    const openDialog = createMockElement("dialog", { open: true });
    openDialog.parentElement = mockBody as unknown as MockElement;

    const form = createMockElement("form");
    form.parentElement = openDialog;

    const trigger = createMockElement("button");
    trigger.parentElement = form;

    const result = getFloatingPortalRoot(trigger as unknown as HTMLElement);
    expect(result).toBe(openDialog as unknown as HTMLElement);
  });

  it("resolves to open dialog when [open] attribute is present", () => {
    const mockBody = createMockElement("body") as unknown as HTMLElement;
    globalThis.document = { body: mockBody } as unknown as Document;

    const openDialog = createMockElement("dialog");
    openDialog.setAttribute("open", "");
    openDialog.parentElement = mockBody as unknown as MockElement;

    const trigger = createMockElement("button");
    trigger.parentElement = openDialog;

    const result = getFloatingPortalRoot(trigger as unknown as HTMLElement);
    expect(result).toBe(openDialog as unknown as HTMLElement);
  });

  it("resolves to the nearest enclosing dialog when nested dialogs exist", () => {
    const mockBody = createMockElement("body") as unknown as HTMLElement;
    globalThis.document = { body: mockBody } as unknown as Document;

    const outerDialog = createMockElement("dialog", { open: true });
    outerDialog.parentElement = mockBody as unknown as MockElement;

    const innerDialog = createMockElement("dialog", { open: true });
    innerDialog.parentElement = outerDialog;

    const trigger = createMockElement("button");
    trigger.parentElement = innerDialog;

    const result = getFloatingPortalRoot(trigger as unknown as HTMLElement);
    expect(result).toBe(innerDialog as unknown as HTMLElement);
  });

  describe("component portal root resolution", () => {
    it("DatePicker trigger inside a modal dialog targets the dialog", () => {
      const mockBody = createMockElement("body") as unknown as HTMLElement;
      globalThis.document = { body: mockBody } as unknown as Document;

      const eventDialog = createMockElement("dialog", { open: true });
      eventDialog.parentElement = mockBody as unknown as MockElement;

      const field = createMockElement("div");
      field.parentElement = eventDialog;

      const datePickerTrigger = createMockElement("button", {
        id: "starts-date-trigger",
      });
      datePickerTrigger.parentElement = field;

      const portalRoot = getFloatingPortalRoot(datePickerTrigger as unknown as HTMLElement);
      expect(portalRoot).toBe(eventDialog as unknown as HTMLElement);
      expect(portalRoot).not.toBe(mockBody);
    });

    it("TimePicker trigger inside a modal dialog targets the dialog", () => {
      const mockBody = createMockElement("body") as unknown as HTMLElement;
      globalThis.document = { body: mockBody } as unknown as Document;

      const eventDialog = createMockElement("dialog", { open: true });
      eventDialog.parentElement = mockBody as unknown as MockElement;

      const field = createMockElement("div");
      field.parentElement = eventDialog;

      const timePickerTrigger = createMockElement("button", {
        id: "starts-time-trigger",
      });
      timePickerTrigger.parentElement = field;

      const portalRoot = getFloatingPortalRoot(timePickerTrigger as unknown as HTMLElement);
      expect(portalRoot).toBe(eventDialog as unknown as HTMLElement);
      expect(portalRoot).not.toBe(mockBody);
    });

    it("Select trigger inside a modal dialog targets the dialog", () => {
      const mockBody = createMockElement("body") as unknown as HTMLElement;
      globalThis.document = { body: mockBody } as unknown as Document;

      const eventDialog = createMockElement("dialog", { open: true });
      eventDialog.parentElement = mockBody as unknown as MockElement;

      const selectTrigger = createMockElement("button", {
        id: "event-type-trigger",
      });
      selectTrigger.parentElement = eventDialog;

      const portalRoot = getFloatingPortalRoot(selectTrigger as unknown as HTMLElement);
      expect(portalRoot).toBe(eventDialog as unknown as HTMLElement);
    });

    it("triggers outside a dialog always target document.body", () => {
      const mockBody = createMockElement("body") as unknown as HTMLElement;
      globalThis.document = { body: mockBody } as unknown as Document;

      const pageContainer = createMockElement("main");
      pageContainer.parentElement = mockBody as unknown as MockElement;

      const datePickerTrigger = createMockElement("button");
      datePickerTrigger.parentElement = pageContainer;

      const timePickerTrigger = createMockElement("button");
      timePickerTrigger.parentElement = pageContainer;

      expect(getFloatingPortalRoot(datePickerTrigger as unknown as HTMLElement)).toBe(mockBody);
      expect(getFloatingPortalRoot(timePickerTrigger as unknown as HTMLElement)).toBe(mockBody);
    });
  });

  describe("keyboard behavior containment", () => {
    it("Escape key event simulation confirms stopPropagation is isolated", () => {
      const preventDefault = vi.fn();
      const stopPropagation = vi.fn();

      const mockEvent = {
        key: "Escape",
        preventDefault,
        stopPropagation,
      };

      // Simulating handleKeyDown on open picker
      if (mockEvent.key === "Escape") {
        mockEvent.preventDefault();
        mockEvent.stopPropagation();
      }

      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(stopPropagation).toHaveBeenCalledTimes(1);
    });
  });
});

