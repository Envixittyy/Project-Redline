import { describe, expect, it } from "vitest";

import {
  hasCalendarCapabilities,
  requireCalendarCapability,
  type ExternalCalendarProvider,
} from "./provider-contract";

describe("calendar provider capabilities", () => {
  it("requires every declared account capability", () => {
    expect(hasCalendarCapabilities(
      ["list_calendars", "list_events"],
      ["list_calendars", "list_events"],
    )).toBe(true);
    expect(hasCalendarCapabilities(
      ["list_calendars"],
      ["list_calendars", "list_events"],
    )).toBe(false);
  });

  it("rejects adapter operations that are not implemented", () => {
    const provider = {
      id: "fixture",
      capabilities: new Set(["list_calendars"] as const),
    } as unknown as ExternalCalendarProvider;
    expect(() => requireCalendarCapability(provider, "list_calendars")).not.toThrow();
    expect(() => requireCalendarCapability(provider, "list_events")).toThrow(
      "fixture does not support list_events",
    );
  });
});
