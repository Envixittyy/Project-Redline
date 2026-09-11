import { describe, expect, it } from "vitest";
import {
  parseQuickCaptureOutput,
  QUICK_CAPTURE_CAPABILITY,
} from "./quick-capture-contract";
import { AiTrustError } from "./trust-contract";

describe("Quick Capture Contract", () => {
  const validHandle = "capture_handle_123";

  it("parses valid task proposal", () => {
    const valid = JSON.stringify({
      schema_version: 1,
      type: "propose_quick_capture",
      source_handle: validHandle,
      captured: {
        timeZone: "local",
        entityType: "task",
        title: "Finish physics homework",
        dueDate: "2026-03-02",
        dueTime: "18:00",
        priority: "high",
      },
      confidence: "HIGH",
    });

    const parsed = parseQuickCaptureOutput(valid, QUICK_CAPTURE_CAPABILITY.id, validHandle);
    expect(parsed.captured.entityType).toBe("task");
    expect(parsed.captured.title).toBe("Finish physics homework");
    expect(parsed.confidence).toBe("HIGH");
  });

  it("parses valid calendar event proposal", () => {
    const valid = JSON.stringify({
      schema_version: 1,
      type: "propose_quick_capture",
      source_handle: validHandle,
      captured: {
        timeZone: "local",
        entityType: "calendar_event",
        title: "Dentist appointment",
        startDate: "2026-03-10",
        endDate: "2026-03-10",
        startTime: "14:00",
        endTime: "15:00",
        allDay: false,
        location: "Dental Clinic",
      },
      confidence: "HIGH",
    });

    const parsed = parseQuickCaptureOutput(valid, QUICK_CAPTURE_CAPABILITY.id, validHandle);
    expect(parsed.captured.entityType).toBe("calendar_event");
    expect(parsed.captured.title).toBe("Dentist appointment");
    expect(parsed.confidence).toBe("HIGH");
  });

  it("rejects capability mismatch", () => {
    expect(() => parseQuickCaptureOutput("{}", "other.cap", validHandle)).toThrow(AiTrustError);
  });
});

