"use client";

import {
  BookOpen,
  HelpCircle,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { generateRoutedProposal } from "@/features/ai/routing-client";
import { getCompanionSession } from "@/services/integrations/ai/companion-session";
import type {
  CourseMaterialSummaryProposal,
  CourseMaterialStudyQuestionsProposal,
  StudyQuestion,
} from "@/services/integrations/ai/course-material-intelligence-contract";

type Mode = "summary" | "questions";

type MaterialOption = {
  id: string;
  title: string;
  materialType: string;
};

type Props = {
  materials: MaterialOption[];
  preselectedMaterialId?: string;
  onClose: () => void;
};

export function CourseMaterialIntelligenceModal({
  materials,
  preselectedMaterialId,
  onClose,
}: Props) {
  const [mode, setMode] = useState<Mode>("summary");
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    preselectedMaterialId ? [preselectedMaterialId] : materials.slice(0, 1).map((m) => m.id),
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summaryResult, setSummaryResult] = useState<CourseMaterialSummaryProposal | null>(null);
  const [questionsResult, setQuestionsResult] = useState<StudyQuestion[] | null>(null);
  const [revealedAnswers, setRevealedAnswers] = useState<Set<number>>(new Set());

  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      controller.current?.abort();
    };
  }, []);

  function toggleMaterial(id: string) {
    if (selectedIds.includes(id)) {
      if (selectedIds.length > 1) {
        setSelectedIds(selectedIds.filter((mId) => mId !== id));
      }
    } else {
      if (selectedIds.length < 3) {
        setSelectedIds([...selectedIds, id]);
      }
    }
  }

  async function handleGenerate(currentMode: Mode) {
    if (selectedIds.length === 0) return;

    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;

    setLoading(true);
    setError(null);
    setRevealedAnswers(new Set());

    const companionConfig = getCompanionSession();
    const kind = currentMode === "summary" ? "material_summary" : "material_study_questions";

    try {
      const result = await generateRoutedProposal(
        kind,
        JSON.stringify({ materialIds: selectedIds }),
        companionConfig,
        abort.signal,
      );

      if (abort.signal.aborted) return;

      if (!result.ok) {
        setError(result.message);
        setLoading(false);
        return;
      }

      const proposal = (result as { ok: true; review: { proposal: unknown } }).review.proposal;

      if (currentMode === "summary") {
        setSummaryResult(proposal as CourseMaterialSummaryProposal);
      } else {
        setQuestionsResult((proposal as CourseMaterialStudyQuestionsProposal).questions);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to analyze materials.");
    } finally {
      setLoading(false);
    }
  }

  function toggleRevealAnswer(index: number) {
    setRevealedAnswers((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div
      style={{
        position: "fixed",
        zIndex: 160,
        inset: 0,
        display: "grid",
        placeItems: "center",
        padding: "1rem",
        background: "var(--scrim, oklch(8% 0.02 255 / 55%))",
        backdropFilter: "blur(12px)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        className="motion-enter"
        style={{
          width: "min(100%, 48rem)",
          maxHeight: "min(52rem, calc(100svh - 2rem))",
          display: "flex",
          flexDirection: "column",
          borderRadius: "var(--radius-xl)",
          border: "1px solid var(--border-strong)",
          background: "var(--surface-modal, oklch(19.5% 0.03 255 / 95%))",
          backdropFilter: "blur(16px)",
          color: "var(--text-primary)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "1.25rem 1.5rem 1rem",
            borderBottom: "1px solid var(--border-subtle)",
            background: "var(--surface-subtle)",
          }}
        >
          <div>
            <p style={{ margin: 0, fontSize: "0.72rem", fontWeight: 750, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent-text)" }}>
              Course Intelligence
            </p>
            <h3 style={{ margin: "0.2rem 0 0", fontSize: "1.2rem", fontWeight: 750, color: "var(--text-primary)" }}>
              Study & Material Analysis
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              minWidth: "2.75rem",
              minHeight: "2.75rem",
              width: "2.75rem",
              height: "2.75rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-subtle)",
              background: "var(--surface)",
              color: "var(--text-secondary)",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Material Selection Chips */}
        <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border-subtle)", background: "var(--surface)" }}>
          <span style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>
            Select Materials (Max 3):
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            {materials.map((m) => {
              const isSelected = selectedIds.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleMaterial(m.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.4rem 0.75rem",
                    minHeight: "2.25rem",
                    borderRadius: "var(--radius-pill)",
                    border: `1px solid ${isSelected ? "var(--accent-border)" : "var(--border-subtle)"}`,
                    background: isSelected ? "var(--accent-muted)" : "var(--surface-subtle)",
                    color: isSelected ? "var(--accent-text)" : "var(--text-secondary)",
                    fontSize: "0.78rem",
                    fontWeight: 650,
                    cursor: "pointer",
                  }}
                >
                  <BookOpen size={12} />
                  {m.title}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tabs & Trigger */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", padding: "0.75rem 1rem", borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                setMode("summary");
                void handleGenerate("summary");
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.5rem 0.8rem",
                minHeight: "2.75rem",
                borderRadius: "var(--radius-md)",
                border: `1px solid ${mode === "summary" ? "var(--accent-border)" : "transparent"}`,
                background: mode === "summary" ? "var(--surface)" : "transparent",
                color: mode === "summary" ? "var(--accent-text)" : "var(--text-secondary)",
                fontSize: "0.82rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <Sparkles size={14} /> Summarize Concepts
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("questions");
                void handleGenerate("questions");
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.5rem 0.8rem",
                minHeight: "2.75rem",
                borderRadius: "var(--radius-md)",
                border: `1px solid ${mode === "questions" ? "var(--accent-border)" : "transparent"}`,
                background: mode === "questions" ? "var(--surface)" : "transparent",
                color: mode === "questions" ? "var(--accent-text)" : "var(--text-secondary)",
                fontSize: "0.82rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <HelpCircle size={14} /> Active Recall Questions
            </button>
          </div>

          <button
            type="button"
            className="motion-tactile"
            onClick={() => handleGenerate(mode)}
            disabled={loading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              padding: "0.5rem 1rem",
              minHeight: "2.75rem",
              borderRadius: "var(--radius-md)",
              background: "var(--accent)",
              color: "var(--accent-foreground)",
              border: "none",
              fontSize: "0.82rem",
              fontWeight: 750,
              cursor: "pointer",
            }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {loading ? "Generating…" : "Run Analysis"}
          </button>
        </div>

        {/* Content View */}
        <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          {error ? (
            <div style={{ padding: "0.75rem 1rem", borderRadius: "var(--radius-md)", background: "color-mix(in srgb, var(--destructive) 15%, transparent)", color: "var(--destructive)", fontSize: "0.82rem" }}>
              {error}
            </div>
          ) : null}

          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem 1.5rem", color: "var(--text-secondary)" }}>
              <Loader2 size={36} className="animate-spin" style={{ color: "var(--accent-text)", marginBottom: "0.75rem" }} />
              <h4 style={{ margin: 0, fontSize: "0.95rem", color: "var(--text-primary)" }}>
                {mode === "summary" ? "Synthesizing course materials…" : "Generating active recall questions…"}
              </h4>
            </div>
          ) : null}

          {/* Summary Mode Output */}
          {!loading && mode === "summary" && summaryResult ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ padding: "1rem", borderRadius: "var(--radius-md)", background: "var(--surface)", border: "1px solid var(--border-subtle)" }}>
                <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.82rem", color: "var(--accent-text)", textTransform: "uppercase" }}>
                  Material Overview
                </h4>
                <p style={{ margin: 0, fontSize: "0.88rem", lineHeight: 1.6, color: "var(--text-primary)" }}>
                  {summaryResult.overview}
                </p>
              </div>

              {summaryResult.keyConcepts.length > 0 ? (
                <div style={{ padding: "1rem", borderRadius: "var(--radius-md)", background: "var(--surface)", border: "1px solid var(--border-subtle)" }}>
                  <h4 style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Key Concepts & Definitions
                  </h4>
                  <div style={{ display: "grid", gap: "0.6rem" }}>
                    {summaryResult.keyConcepts.map((c, idx) => (
                      <div key={idx} style={{ padding: "0.65rem 0.85rem", borderRadius: "var(--radius-sm)", background: "var(--surface-subtle)", border: "1px solid var(--border-subtle)" }}>
                        <strong style={{ color: "var(--accent-text)", fontSize: "0.85rem" }}>{c.term}:</strong>{" "}
                        <span style={{ fontSize: "0.85rem", color: "var(--text-primary)" }}>{c.definition}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {summaryResult.practicalTakeaways.length > 0 ? (
                <div style={{ padding: "1rem", borderRadius: "var(--radius-md)", background: "var(--surface)", border: "1px solid var(--border-subtle)" }}>
                  <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.82rem", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Practical Takeaways
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: "1.2rem", display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.86rem", color: "var(--text-primary)" }}>
                    {summaryResult.practicalTakeaways.map((t, idx) => (
                      <li key={idx}>{t}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Questions Mode Output */}
          {!loading && mode === "questions" && questionsResult ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h4 style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                  {questionsResult.length} Study Questions
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    if (revealedAnswers.size === questionsResult.length) {
                      setRevealedAnswers(new Set());
                    } else {
                      setRevealedAnswers(new Set(questionsResult.map((_, i) => i)));
                    }
                  }}
                  style={{ background: "transparent", border: "none", color: "var(--accent-text)", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}
                >
                  {revealedAnswers.size === questionsResult.length ? "Hide All Answers" : "Reveal All Answers"}
                </button>
              </div>

              {questionsResult.map((q, idx) => {
                const isRevealed = revealedAnswers.has(idx);
                return (
                  <div
                    key={idx}
                    style={{
                      padding: "1rem",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border-subtle)",
                      background: "var(--surface)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.6rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem" }}>
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                        <span style={{ fontSize: "0.78rem", fontWeight: 800, color: "var(--accent-text)" }}>
                          Q{idx + 1}.
                        </span>
                        <p style={{ margin: 0, fontSize: "0.88rem", fontWeight: 650, color: "var(--text-primary)" }}>
                          {q.question}
                        </p>
                      </div>
                      <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0 }}>
                        {q.conceptTag && (
                          <span style={{ fontSize: "0.68rem", padding: "0.15rem 0.4rem", borderRadius: "var(--radius-pill)", background: "var(--surface-subtle)", color: "var(--text-secondary)" }}>
                            {q.conceptTag}
                          </span>
                        )}
                        <span style={{ fontSize: "0.68rem", padding: "0.15rem 0.4rem", borderRadius: "var(--radius-pill)", border: "1px solid var(--border-subtle)", textTransform: "uppercase", fontWeight: 700 }}>
                          {q.difficulty || "med"}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleRevealAnswer(idx)}
                      style={{
                        alignSelf: "flex-start",
                        background: "transparent",
                        border: "none",
                        color: "var(--accent-text)",
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        padding: 0,
                        cursor: "pointer",
                      }}
                    >
                      {isRevealed ? "Hide Answer ▲" : "Show Answer ▼"}
                    </button>

                    {isRevealed && (
                      <div
                        className="motion-enter"
                        style={{
                          padding: "0.75rem 0.9rem",
                          borderRadius: "var(--radius-sm)",
                          background: "var(--surface-subtle)",
                          borderLeft: "3px solid var(--accent)",
                          fontSize: "0.85rem",
                          lineHeight: 1.55,
                          color: "var(--text-primary)",
                        }}
                      >
                        <strong>Answer:</strong> {q.answer}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
