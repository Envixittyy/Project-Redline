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


const activated = [
  ["note_summary", "noteSummary.propose"],
  ["note_rewrite", "noteRewrite.propose"],
  ["note_action_items", "noteActionItems.propose"],
  ["quick_capture", "quickCapture.propose"],
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

  it.each(activated)("%s requires its own privacy permission",(kind,capability)=>{
    const prefs:RoutingPreferences={aiMode:"gemini",cloudEnabled:true,cloudFallbackMode:"ask_each_time",preferredCloud:"gemini",secondaryCloud:true,checklistCloud:true,courseImportCloud:true,dailyPlanCloud:true,courseMaterialCloud:true,contextualAssistantCloud:true};
    expect(capabilityFor(kind as RequestKind).id).toBe(capability);
    expect(cloudAllowed(capability,prefs)).toBe(false);
    expect(cloudAllowed(capability,{...prefs,...(kind==="quick_capture"?{quickCaptureCloud:true}:{notesCloud:true})})).toBe(true);
    expect(mayFallback("invalid_output","local")).toBe(false);
  });
  it("unknown capabilities remain denied",()=>{expect(()=>capabilityFor("execute_sql" as RequestKind)).toThrow();expect(fetchMock).not.toHaveBeenCalled();});

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
