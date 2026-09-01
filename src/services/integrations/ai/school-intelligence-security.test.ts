import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const dependencies = vi.hoisted(() => ({ auth: vi.fn(), task: vi.fn(), event: vi.fn() }));
vi.mock("@/services/supabase/request", () => ({ requireAuthenticatedSupabase: dependencies.auth }));
vi.mock("@/services/tasks/task-repository", () => ({ createTask: dependencies.task }));
vi.mock("@/services/calendar-events/calendar-event-repository", () => ({ createCalendarEvent: dependencies.event }));
import { capabilityFor, cloudAllowed, mayFallback, routingChain, type RequestKind, type RoutingPreferences } from "./routing-contract";
import { inferCloud } from "./cloud-provider";
import { OllamaAdapter } from "@/companion/adapters/ollama-adapter";
import { LlamaCppAdapter } from "@/companion/adapters/llamacpp-adapter";
import { OpenAiCompatibleAdapter } from "@/companion/adapters/openai-compatible-adapter";
import { confirmPredictionAsTask, confirmPredictionAsEvent } from "@/services/school/prediction-service";

const denied = [
  ["note_summary", "noteSummary.propose"],
  ["note_rewrite", "noteRewrite.propose"],
  ["note_action_items", "noteActionItems.propose"],
  ["quick_capture", "quickCapture.propose"],
  ["daily_plan_advice", "dailyPlanAdvice.propose"],
  ["material_summary", "courseMaterialSummary.propose"],
  ["material_study_questions", "courseMaterialStudyQuestions.propose"],
  ["contextual_assistant", "contextualAssistant.propose"],
] as const;
const fetchMock = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("School Intelligence containment", () => {
  it.each([
    ["schedule_image", "schoolScheduleImage.propose", "schoolScheduleCloud"],
    ["blackboard_image", "blackboardCourseImage.propose", "blackboardCourseCloud"],
  ] as const)("activates only trusted %s routing", (kind, capability, preference) => {
    const prefs: RoutingPreferences = { aiMode: "gemini", cloudEnabled: true, cloudFallbackMode: "ask_each_time", preferredCloud: "gemini", secondaryCloud: false,
      checklistCloud: false, courseImportCloud: false, [preference]: true };
    expect(capabilityFor(kind).id).toBe(capability);
    expect(cloudAllowed(capability, prefs)).toBe(true);
    expect(routingChain(prefs, capability)).toEqual(["gemini"]);
    const denied = { ...prefs, [preference]: false };
    expect(cloudAllowed(capability, denied)).toBe(false);
    expect(() => routingChain(denied, capability)).toThrow("cloud_privacy_denied");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("activates Academic Calendar only through its dedicated consent flag", () => {
    const prefs: RoutingPreferences = { aiMode: "gemini", cloudEnabled: true, cloudFallbackMode: "ask_each_time", preferredCloud: "gemini", secondaryCloud: false,
      checklistCloud: false, courseImportCloud: false, academicCalendarCloud: true };
    expect(capabilityFor("academic_calendar").id).toBe("academicCalendarImport.propose");
    expect(cloudAllowed("academicCalendarImport.propose", prefs)).toBe(true);
    expect(cloudAllowed("academicCalendarImport.propose", { ...prefs, academicCalendarCloud: false })).toBe(false);
  });
  it("permits predictions only through local routing even when assessment cloud consent is stored", () => {
    const prefs: RoutingPreferences = {
      aiMode: "auto", cloudEnabled: true, cloudFallbackMode: "ask_each_time",
      preferredCloud: "gemini", secondaryCloud: true, assessmentPredictionCloud: true,
      checklistCloud: false, courseImportCloud: false,
    };
    expect(capabilityFor("assessment_prediction").id).toBe("schoolAssessmentPrediction.propose");
    expect(cloudAllowed("schoolAssessmentPrediction.propose", prefs)).toBe(false);
    expect(routingChain(prefs, "schoolAssessmentPrediction.propose")).toEqual(["local"]);
    expect(() => routingChain({ ...prefs, aiMode: "gemini" }, "schoolAssessmentPrediction.propose"))
      .toThrow("cloud_privacy_denied");
  });

  it.each(denied)("%s cannot inherit existing cloud preferences or preparation authority", (kind, capability) => {
    for (const aiMode of ["auto", "local", "gemini", "openrouter"] as const) {
      const prefs: RoutingPreferences = { aiMode, cloudEnabled: true, cloudFallbackMode: "ask_each_time", preferredCloud: "gemini", secondaryCloud: true, checklistCloud: true, courseImportCloud: true,
        schoolScheduleCloud: true, blackboardCourseCloud: true, academicCalendarCloud: true, assessmentPredictionCloud: true, notesCloud: true, quickCaptureCloud: true, dailyPlanCloud: true, courseMaterialCloud: true, contextualAssistantCloud: true };
      expect(cloudAllowed(capability, prefs)).toBe(false);
      expect(() => capabilityFor(kind as RequestKind)).toThrow("school_intelligence_review_required");
    }
    expect(mayFallback("school_intelligence_review_required", "local")).toBe(false);
  });

  it.each([
    () => import("./note-intelligence-repository"),
    () => import("./quick-capture-repository"),
    () => import("./daily-plan-repository"),
    () => import("./course-material-intelligence-repository"),
    () => import("./contextual-assistant-repository"),
  ])("direct repository entry points cannot bypass the router quarantine %#", async load => {
    const repository = await load();
    for (const fn of Object.values(repository)) {
      if (typeof fn !== "function") continue;
      // Malformed input must be denied before parsing, reading or writing. Repeat
      // to cover replay; no fabricated source/review or payload is authority.
      for (let replay = 0; replay < 2; replay++) {
        await expect(Promise.resolve().then(() => (fn as () => unknown)())).rejects.toThrow("school_intelligence_review_required");
        await expect(Promise.resolve().then(() => (fn as (...args: unknown[]) => unknown)(
          "11111111-1111-4111-8111-111111111111",
          { title: "Substituted payload", noteId: "22222222-2222-4222-8222-222222222222", type: "arbitrary_operation" },
          "ollama", "fixture",
        ))).rejects.toThrow("school_intelligence_review_required");
      }
    }
    expect(dependencies.auth).not.toHaveBeenCalled();
    expect(dependencies.task).not.toHaveBeenCalled();
    expect(dependencies.event).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("malformed and repeated prediction requests cannot create entities before any read", async () => {
    for (const id of ["missing", "11111111-1111-4111-8111-111111111111"]) {
      const results = await Promise.allSettled([
        confirmPredictionAsTask(id, { title: "Forged", dueDate: "2026-08-31" }),
        confirmPredictionAsTask(id, { title: "Replay", dueDate: "2026-08-31" }),
        confirmPredictionAsEvent(id, { title: "Forged", startsAt: "invalid", endsAt: "invalid", allDay: false }),
      ]);
      expect(results.every(result => result.status === "rejected")).toBe(true);
    }
    expect(dependencies.auth).not.toHaveBeenCalled();
    expect(dependencies.task).not.toHaveBeenCalled();
    expect(dependencies.event).not.toHaveBeenCalled();
  });

  it.each([new OllamaAdapter(), new LlamaCppAdapter(), new OpenAiCompatibleAdapter()])("$id rejects image input before runtime egress, independent of the model name", async adapter => {
    for (const images of [[], ["https://attacker.invalid/image"], ["data:image/svg+xml;base64,AAAA"], Array(100).fill("AAAA")]) {
      const result = await adapter.infer("http://127.0.0.1:1234", { model: "vision-model", prompt: "source", images });
      expect(result).toMatchObject({ ok: false, error: "unsupported_modality", failureCode: "unsupported_modality" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["gemini", "openrouter"] as const)("%s cannot upload binary data even if called directly", async provider => {
    await expect(inferCloud(provider, { model: "vision-model", prompt: "source", images: ["data:image/png;base64,AAAA"] })).rejects.toThrow("capability_denied");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
