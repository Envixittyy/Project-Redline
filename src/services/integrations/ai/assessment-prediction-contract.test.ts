import { describe, expect, it } from "vitest";
import {
  parseAssessmentPredictionOutput,
  ASSESSMENT_PREDICTION_CAPABILITY,
} from "./assessment-prediction-contract";
import { AiTrustError } from "./trust-contract";

describe("Assessment Prediction Contract", () => {
  const validHandle = "predict_handle_123";

  it("parses valid assessment predictions proposal", () => {
    const validJson = JSON.stringify({
      schema_version: 1,
      type: "propose_assessment_predictions",
      source_handle: validHandle,
      predictions: [
        {
          courseId: "course-123",
          title: "Midterm Exam",
          predictionType: "exam",
          predictedDate: "2026-03-20",
          predictedTime: "10:00",
          confidence: "HIGH",
          rationale: "Syllabus specifies Midterm in Week 8 Friday session.",
          sourceReference: "Syllabus Schedule table",
        },
      ],
    });

    const parsed = parseAssessmentPredictionOutput(
      validJson,
      ASSESSMENT_PREDICTION_CAPABILITY.id,
      validHandle,
    );

    expect(parsed.predictions).toHaveLength(1);
    expect(parsed.predictions[0].title).toBe("Midterm Exam");
    expect(parsed.predictions[0].confidence).toBe("HIGH");
    expect(parsed.predictions[0].predictedDate).toBe("2026-03-20");
  });

  it("rejects capability mismatch", () => {
    expect(() =>
      parseAssessmentPredictionOutput("{}", "other.capability", validHandle),
    ).toThrow(AiTrustError);
  });

  it("rejects invalid date format", () => {
    const invalidJson = JSON.stringify({
      schema_version: 1,
      type: "propose_assessment_predictions",
      source_handle: validHandle,
      predictions: [
        {
          courseId: "course-123",
          title: "Quiz 1",
          predictionType: "quiz",
          predictedDate: "03/20/2026", // Invalid format
          confidence: "HIGH",
          rationale: "Rationale",
        },
      ],
    });

    expect(() =>
      parseAssessmentPredictionOutput(
        invalidJson,
        ASSESSMENT_PREDICTION_CAPABILITY.id,
        validHandle,
      ),
    ).toThrow(AiTrustError);
  });

  it("rejects unknown confidence value", () => {
    const invalidJson = JSON.stringify({
      schema_version: 1,
      type: "propose_assessment_predictions",
      source_handle: validHandle,
      predictions: [
        {
          courseId: "course-123",
          title: "Quiz 1",
          predictionType: "quiz",
          predictedDate: "2026-03-20",
          confidence: "VERY_CONFIDENT", // Invalid
          rationale: "Rationale",
        },
      ],
    });

    expect(() =>
      parseAssessmentPredictionOutput(
        invalidJson,
        ASSESSMENT_PREDICTION_CAPABILITY.id,
        validHandle,
      ),
    ).toThrow(AiTrustError);
  });
});

