import { describe, expect, it } from "vitest";
import { cloudAllowed, localSelection, mayFallback, routingChain, type RoutingPreferences } from "./routing-contract";
const base: RoutingPreferences = { aiMode: "auto", cloudEnabled: false, cloudFallbackMode: "ask_each_time", preferredCloud: "gemini", secondaryCloud: false, checklistCloud: false, courseImportCloud: false };
describe("provider-neutral routing and privacy", () => {
  it("defaults to local with no cloud egress authorization", () => expect(routingChain(base, "taskChecklist.propose")).toEqual(["local"]));
  it("supports local preference, both cloud selections and configurable ordering", () => {
    const p = { ...base, cloudEnabled: true, checklistCloud: true, secondaryCloud: true };
    expect(routingChain(p, "taskChecklist.propose")).toEqual(["local", "gemini", "openrouter"]);
    expect(routingChain({ ...p, preferredCloud: "openrouter" }, "taskChecklist.propose")).toEqual(["local", "openrouter", "gemini"]);
    expect(routingChain({ ...p, aiMode: "local" }, "taskChecklist.propose")).toEqual(["local"]);
    for (const aiMode of ["gemini", "openrouter"] as const) expect(routingChain({ ...p, aiMode }, "taskChecklist.propose")).toEqual([aiMode]);
  });
  it.each(["wellness.privateJournal", "notes.read", "delete_task", "__proto__", "constructor"])("denies unknown/sensitive capability %s even with all current toggles", cap => {
    expect(cloudAllowed(cap, { ...base, cloudEnabled: true, checklistCloud: true, courseImportCloud: true })).toBe(false);
  });
  it("checks each domain and explicit provider cannot bypass privacy", () => {
    expect(cloudAllowed("courseImport.propose", { ...base, cloudEnabled: true, checklistCloud: true })).toBe(false);
    expect(() => routingChain({ ...base, aiMode: "gemini" }, "taskChecklist.propose")).toThrow("cloud_disabled");
    expect(() => routingChain({ ...base, aiMode: "openrouter", cloudEnabled: true }, "taskChecklist.propose")).toThrow("cloud_privacy_denied");
  });
  it.each(["invalid_output", "unsupported_modality", "capability_denied", "source_changed", "pairing_invalid", "cancelled", "provider_rejected"])("never fallback for %s", code => {
    expect(mayFallback(code, "local")).toBe(false); expect(mayFallback(code, "cloud")).toBe(false);
  });
  it("allows infrastructure failure but stops ambiguous cloud transfers", () => {
    expect(mayFallback("timeout", "local")).toBe(true); expect(mayFallback("timeout", "cloud")).toBe(false);
    expect(mayFallback("network_unavailable", "cloud")).toBe(false);
    expect(mayFallback("rate_limited", "cloud")).toBe(true);
  });
  it("rejects source/provider injection and arbitrary configuration", () => {
    expect(() => localSelection({ provider: "gemini", model: "x", location: "local" })).toThrow();
    expect(() => localSelection({ provider: "ollama", model: "x", location: "local", capability: "delete_task" })).toThrow();
    expect(() => localSelection({ provider: "ollama", model: "https://evil/x?secret=1", location: "local" })).toThrow();
  });
});
