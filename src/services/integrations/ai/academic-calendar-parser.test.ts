import { describe, expect, it } from "vitest";
import { parseAcademicCsv, parseAcademicIcs, resolveExtractedAcademicEntries } from "./academic-calendar-parser";

const zone = "Asia/Manila";
const ics = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR`;
const vevent = (uid: string, title: string, start: string, extra = "") => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${title}\r\nDTSTART;VALUE=DATE:${start}\r\n${extra}END:VEVENT`;

describe("bounded Academic Calendar parsers and server identity", () => {
  it("uses UID plus recurrence ID, preserving same-title and same-date events", () => {
    const parsed = parseAcademicIcs(ics(`${vevent("one@example", "Holiday", "20260901")}\r\n${vevent("two@example", "Holiday", "20260901")}`), zone);
    expect(parsed).toHaveLength(2); expect(parsed[0].identityKey).not.toBe(parsed[1].identityKey);
    expect(parseAcademicIcs(ics(vevent("series@example", "Class", "20260901", "RECURRENCE-ID;VALUE=DATE:20260901\r\n")), zone)[0].identityEvidence).toContain("series@example");
  });
  it("keeps a same UID stable across title/date changes", () => {
    const before = parseAcademicIcs(ics(vevent("stable@example", "Old", "20260901")), zone)[0];
    const after = parseAcademicIcs(ics(vevent("stable@example", "New", "20260909")), zone)[0];
    expect(after.identityKey).toBe(before.identityKey); expect(after.event).not.toEqual(before.event);
  });
  it.each([
    ["duplicate UID", ics(`${vevent("dup@example", "One", "20260901")}\r\n${vevent("dup@example", "Two", "20260902")}`)],
    ["malformed UID", ics(vevent("bad uid", "One", "20260901"))],
    ["malformed date", ics(vevent("one@example", "One", "20261340"))],
    ["duplicate property", ics(vevent("one@example", "One", "20260901", "SUMMARY:Two\r\n"))],
  ])("rejects ICS %s", (_name, source) => expect(() => parseAcademicIcs(source, zone)).toThrow());
  it("uses explicit CSV IDs and preserves collisions", () => {
    const parsed = parseAcademicCsv("id,title,start\na,Holiday,2026-09-01\nb,Holiday,2026-09-01", zone);
    expect(parsed[0].identityKey).not.toBe(parsed[1].identityKey);
    expect(parseAcademicCsv("id,title,start\na,Changed,2026-09-09", zone)[0].identityKey).toBe(parsed[0].identityKey);
  });
  it("rejects duplicate CSV IDs, unknown columns, malformed dates and bounds", () => {
    expect(() => parseAcademicCsv("id,title,start\na,One,2026-09-01\na,Two,2026-09-02", zone)).toThrow();
    expect(() => parseAcademicCsv("title,start,owner_id\nOne,2026-09-01,x", zone)).toThrow();
    expect(() => parseAcademicCsv("title,start\nOne,not-a-date", zone)).toThrow();
    expect(() => parseAcademicCsv("title,start\n" + Array.from({ length: 61 }, (_, i) => `E${i},2026-09-01`).join("\n"), zone)).toThrow();
  });
  it("requires unique exact text evidence and resolves image identity server-side", () => {
    const event = { title: "Break", description: null, start: "2026-03-15T16:00:00.000Z", end: "2026-03-16T16:00:00.000Z", allDay: true, eventType: "break" as const };
    expect(resolveExtractedAcademicEntries("txt", "Break: March 16", [{ ...event, evidence: "Break: March 16" }])[0].identityKind).toBe("structure_semantic");
    expect(() => resolveExtractedAcademicEntries("md", "Break\nBreak", [{ ...event, evidence: "Break" }])).toThrow();
    expect(() => resolveExtractedAcademicEntries("txt", "No date", [{ ...event, evidence: "missing" }])).toThrow();
    expect(resolveExtractedAcademicEntries("webp", null, [event])[0].identityKind).toBe("resolved_semantic");
  });
});
