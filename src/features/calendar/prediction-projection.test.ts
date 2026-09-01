import { describe, expect, it } from "vitest";
import { predictionToCalendarEntry } from "./calendar-domain";
import { buildCalendarItems } from "./calendar-items";
import type { SchoolAssessmentPrediction } from "@/services/school/prediction-service";

const prediction: SchoolAssessmentPrediction = {
  id: "prediction", userId: "owner", courseId: "course", courseCode: "CS1", title: "Quiz",
  predictionType: "quiz", predictedDate: "2026-09-01", predictedTime: null, confidence: "MEDIUM",
  status: "active", rationale: "Selected syllabus rule", sourceReference: null,
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", stale: false,
};

describe("Persisted prediction projection", () => {
  it("uses exclusive local-day boundaries, labels Possible, and stays a prediction", () => {
    const entry = predictionToCalendarEntry(prediction, "Asia/Manila");
    expect(entry).toMatchObject({ kind: "assessment_prediction", title: "◇ Possible Quiz", date: "2026-09-01",
      start: "2026-08-31T16:00:00.000Z", end: "2026-09-01T16:00:00.000Z", allDay: true });
  });
  it("handles DST day lengths without inventing UTC all-day times", () => {
    const entry = predictionToCalendarEntry({ ...prediction, predictedDate: "2026-03-08" }, "America/New_York");
    expect(Date.parse(entry!.end!) - Date.parse(entry!.start!)).toBe(23 * 60 * 60 * 1000);
  });
  it.each([{ stale: true }, { confidence: "LOW" as const }, { status: "dismissed" as const }, { status: "superseded" as const }])("hides unavailable predictions %#", patch => {
    expect(predictionToCalendarEntry({ ...prediction, ...patch }, "Asia/Manila")).toBeNull();
  });
  it("does not display predictions outside the requested range or turn them into events", () => {
    const items = buildCalendarItems([], [], [], "Asia/Manila", [], "2026-09-01", "2026-09-02", [], [], [], [
      prediction, { ...prediction, id: "outside", predictedDate: "2026-09-02" }, { ...prediction, id: "stale", stale: true },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("assessment_prediction");
  });
});
