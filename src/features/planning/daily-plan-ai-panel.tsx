"use client";

import { Lightbulb, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { generateRoutedProposal } from "@/features/ai/routing-client";
import { getCompanionSession } from "@/services/integrations/ai/companion-session";
import type { DailyPlanAdviceProposal } from "@/services/integrations/ai/daily-plan-contract";
import type { Task } from "@/types/task";
import type { CalendarItem } from "@/features/calendar/calendar-items";

type DailyPlanAiPanelProps = {
  tasks: Task[];
  scheduleItems: CalendarItem[];
  timeZone: string;
};

export function DailyPlanAiPanel({
  tasks,
  scheduleItems,
  timeZone,
}: DailyPlanAiPanelProps) {
  const [loading, setLoading] = useState(false);
  const [advice, setAdvice] = useState<DailyPlanAdviceProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchAdvice() {
    setLoading(true);
    setError(null);
    const companionConfig = getCompanionSession();

    const context = {
      today: new Date().toISOString().slice(0, 10),
      timeZone,
      tasks: tasks.map((t) => ({
        title: t.title,
        priority: t.priority,
        dueDate: t.dueDate,
      })),
      events: scheduleItems.map((it) => ({
        title: it.entry.title,
        start: it.entry.start ?? "",
        end: it.entry.end ?? it.entry.start ?? "",
        allDay: Boolean(it.entry.allDay),
      })),
    };

    try {
      const result = await generateRoutedProposal(
        "daily_plan_advice",
        JSON.stringify(context),
        companionConfig,
      );

      if (!result.ok) {
        setError(result.message);
        return;
      }

      const proposal = ((result as unknown) as { ok: true; review: { advice: DailyPlanAdviceProposal } }).review.advice;
      setAdvice(proposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load advice.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        margin: "0.75rem 0",
        padding: "1rem",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-subtle)",
        background: "var(--surface)",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
          <Sparkles size={16} color="var(--accent-text)" />
          <h4 style={{ margin: 0, fontSize: "0.88rem", fontWeight: 700, color: "var(--text-primary)" }}>
            AI Workload & Pacing Advice
          </h4>
        </div>
        {!advice && (
          <button
            type="button"
            className="motion-tactile"
            onClick={fetchAdvice}
            disabled={loading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              padding: "0.35rem 0.75rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--accent-border)",
              background: "var(--accent-muted)",
              color: "var(--accent-text)",
              fontSize: "0.78rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {loading ? "Analyzing…" : "Get Advice"}
          </button>
        )}
      </div>

      {error ? (
        <div style={{ color: "var(--destructive)", fontSize: "0.8rem", fontWeight: 600 }}>
          {error}
        </div>
      ) : null}

      {advice ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", fontSize: "0.84rem" }}>
          <div style={{ color: "var(--text-primary)", lineHeight: 1.55 }}>
            {advice.workloadExplanation}
          </div>

          {advice.prioritizationSuggestions.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <strong style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "var(--accent-text)", letterSpacing: "0.04em" }}>
                Prioritization Tips
              </strong>
              <ul style={{ margin: 0, paddingLeft: "1.2rem", display: "flex", flexDirection: "column", gap: "0.25rem", color: "var(--text-secondary)" }}>
                {advice.prioritizationSuggestions.map((sug, idx) => (
                  <li key={idx}>
                    <Lightbulb size={12} style={{ display: "inline", marginRight: "0.35rem", color: "var(--accent-text)" }} />
                    {sug}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div style={{ color: "var(--text-tertiary)", fontSize: "0.78rem", borderTop: "1px solid var(--border-subtle)", paddingTop: "0.5rem" }}>
            <strong>Schedule Rationale:</strong> {advice.scheduleRationale}
          </div>
        </div>
      ) : null}
    </div>
  );
}
