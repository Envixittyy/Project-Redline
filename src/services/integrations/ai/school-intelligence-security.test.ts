import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const dependencies = vi.hoisted(() => ({ auth: vi.fn(), task: vi.fn(), event: vi.fn() }));
vi.mock("@/services/supabase/request", () => ({ requireAuthenticatedSupabase: dependencies.auth }));
vi.mock("@/services/tasks/task-repository", () => ({ createTask: dependencies.task }));
vi.mock("@/services/calendar-events/calendar-event-repository", () => ({ createCalendarEvent: dependencies.event }));
import { capabilityFor, cloudAllowed, type RequestKind, type RoutingPreferences } from "./routing-contract";
import { OllamaAdapter } from "@/companion/adapters/ollama-adapter";
import { LlamaCppAdapter } from "@/companion/adapters/llamacpp-adapter";
import { OpenAiCompatibleAdapter } from "@/companion/adapters/openai-compatible-adapter";
import { confirmPredictionAsTask, confirmPredictionAsEvent } from "@/services/school/prediction-service";

const capabilities = [
  ["schedule_image", "schoolScheduleImage.propose", "schoolScheduleCloud"],
  ["blackboard_image", "blackboardCourseImage.propose", "blackboardCourseCloud"],
  ["academic_calendar", "academicCalendarImport.propose", "academicCalendarCloud"],
  ["assessment_prediction", "schoolAssessmentPrediction.propose", "assessmentPredictionCloud"],
  ["note_summary", "noteSummary.propose", "notesCloud"],
  ["note_rewrite", "noteRewrite.propose", "notesCloud"],
  ["note_action_items", "noteActionItems.propose", "notesCloud"],
  ["quick_capture", "quickCapture.propose", "quickCaptureCloud"],
  ["daily_plan_advice", "dailyPlanAdvice.propose", "dailyPlanCloud"],
  ["material_summary", "courseMaterialSummary.propose", "courseMaterialCloud"],
  ["material_study_questions", "courseMaterialStudyQuestions.propose", "courseMaterialCloud"],
  ["contextual_assistant", "contextualAssistant.propose", "contextualAssistantCloud"],
] as const;

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  process.env.AI_TRUST_SIGNING_KEY = "07".repeat(32);
});
afterEach(() => vi.unstubAllGlobals());

describe("School Intelligence Trust & Privacy Boundaries", () => {
  it.each(capabilities)("%s requires explicit capability-specific cloud consent", (kind, capability, prefKey) => {
    // 1. Without specific capability flag, cloud is strictly disallowed
    const basePrefs: RoutingPreferences = {
      aiMode: "auto",
      cloudEnabled: true,
      cloudFallbackMode: "ask_each_time",
      preferredCloud: "gemini",
      secondaryCloud: true,
      checklistCloud: true,
      courseImportCloud: true,
    };
    expect(cloudAllowed(capability, basePrefs)).toBe(false);
    expect(capabilityFor(kind as RequestKind).id).toBe(capability);

    // 2. With capability-specific flag enabled, cloud is permitted
    const enabledPrefs: RoutingPreferences = {
      ...basePrefs,
      [prefKey]: true,
    };
    expect(cloudAllowed(capability, enabledPrefs)).toBe(true);
  });

  it.each([
    () => import("./schedule-import-repository"),
    () => import("./blackboard-screenshot-repository"),
    () => import("./academic-calendar-repository"),
    () => import("./assessment-prediction-repository"),
    () => import("./note-intelligence-repository"),
    () => import("./quick-capture-repository"),
    () => import("./daily-plan-repository"),
    () => import("./course-material-intelligence-repository"),
    () => import("./contextual-assistant-repository"),
  ])("direct repository entry points fail closed on untrusted/malformed inputs %#", async load => {
    dependencies.auth.mockResolvedValue({
      client: {
        rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "untrusted" } }),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: { message: "not_found" } }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "not_found" } }),
        }),
      },
      userId: "11111111-1111-4111-8111-111111111111",
    });

    const repository = await load();
    for (const fn of Object.values(repository)) {
      if (typeof fn !== "function") continue;
      // Untrusted call without valid parameters fails closed
      for (let replay = 0; replay < 2; replay++) {
        await expect(Promise.resolve().then(() => (fn as () => unknown)())).rejects.toThrow();
      }
    }
    expect(dependencies.task).not.toHaveBeenCalled();
    expect(dependencies.event).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("malformed prediction requests cannot bypass signed atomic conversion RPCs", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: { ok: false, error: "prediction_unavailable" }, error: null });
    dependencies.auth.mockResolvedValue({
      client: { rpc: mockRpc },
      userId: "11111111-1111-4111-8111-111111111111",
    });

    for (const id of ["missing", "11111111-1111-4111-8111-111111111111"]) {
      const taskRes = await confirmPredictionAsTask(id, { title: "Test", dueDate: "2026-08-31" });
      expect(taskRes.ok).toBe(false);

      const eventRes = await confirmPredictionAsEvent(id, { title: "Test", startsAt: "2026-08-31", endsAt: "2026-08-31", allDay: true });
      expect(eventRes.ok).toBe(false);
    }
    expect(dependencies.task).not.toHaveBeenCalled();
    expect(dependencies.event).not.toHaveBeenCalled();
  });

  it.each([new OllamaAdapter(), new LlamaCppAdapter(), new OpenAiCompatibleAdapter()])("$id rejects image input before runtime egress, independent of the model name", async adapter => {
    for (const images of [[], ["https://attacker.invalid/image"], ["data:image/svg+xml;base64,AAAA"], Array(100).fill("AAAA")]) {
      const result = await adapter.infer("http://127.0.0.1:1234", { model: "vision-model", prompt: "source", images });
      expect(result).toMatchObject({ ok: false, error: "unsupported_modality", failureCode: "invalid_output" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
