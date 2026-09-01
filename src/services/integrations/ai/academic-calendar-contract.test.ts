import { describe, expect, it } from "vitest";
import { ACADEMIC_CALENDAR_CAPABILITY, academicCalendarPrompt, parseAcademicCalendarOutput } from "./academic-calendar-contract";

describe("trusted Academic Calendar extraction contract", () => {
  const handle = "academic_fixture", zone = "Asia/Manila";
  const output = (overrides: Record<string, unknown> = {}) => JSON.stringify({ schema_version: 2, type: "extract_academic_calendar", source_handle: handle,
    events: [{ title: "Spring Break", start: "2026-03-16", end: "2026-03-21", allDay: true, eventType: "break", evidence: "Spring Break: March 16-20" }], ...overrides });
  it("normalizes strict TXT/MD events without accepting model identity", () => {
    expect(parseAcademicCalendarOutput(output(), ACADEMIC_CALENDAR_CAPABILITY.id, handle, "txt", zone).events[0]).toMatchObject({ title: "Spring Break", start: "2026-03-15T16:00:00.000Z" });
    expect(() => parseAcademicCalendarOutput(output({ events: [{ title: "Break", start: "2026-03-16", allDay: true, eventType: "break", evidence: "Break", id: "model-id" }] }), ACADEMIC_CALENDAR_CAPABILITY.id, handle, "txt", zone)).toThrow();
  });
  it.each([
    ["missing date", { title: "Break", allDay: true, eventType: "break", evidence: "Break" }],
    ["malformed date", { title: "Break", start: "soon", allDay: true, eventType: "break", evidence: "Break" }],
    ["missing evidence", { title: "Break", start: "2026-03-16", allDay: true, eventType: "break" }],
  ])("rejects %s", (_name, bad) => expect(() => parseAcademicCalendarOutput(output({ events: [bad] }), ACADEMIC_CALENDAR_CAPABILITY.id, handle, "md", zone)).toThrow());
  it("rejects oversized, malformed, capability-swapped, handle-swapped, and image evidence output", () => {
    expect(() => parseAcademicCalendarOutput("x".repeat(65537), ACADEMIC_CALENDAR_CAPABILITY.id, handle, "txt", zone)).toThrow();
    expect(() => parseAcademicCalendarOutput("{}", ACADEMIC_CALENDAR_CAPABILITY.id, handle, "txt", zone)).toThrow();
    expect(() => parseAcademicCalendarOutput(output(), "other", handle, "txt", zone)).toThrow();
    expect(() => parseAcademicCalendarOutput(output({ source_handle: "other" }), ACADEMIC_CALENDAR_CAPABILITY.id, handle, "txt", zone)).toThrow();
    expect(() => parseAcademicCalendarOutput(output(), ACADEMIC_CALENDAR_CAPABILITY.id, handle, "png", zone)).toThrow();
  });
  it("discloses normalized text only for text formats and never asks a model for IDs", () => {
    expect(academicCalendarPrompt(handle, "txt", "trusted text").prompt).toContain("trusted text");
    expect(academicCalendarPrompt(handle, "png").prompt).not.toContain("trusted text");
    expect(academicCalendarPrompt(handle, "png").systemPrompt).toContain("Do not return IDs");
  });
});
