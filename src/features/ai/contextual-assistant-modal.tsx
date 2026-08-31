"use client";

import {
  HelpCircle,
  Loader2,
  Quote,
  Send,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { generateRoutedProposal } from "@/features/ai/routing-client";
import { getCompanionSession } from "@/services/integrations/ai/companion-session";
import type { ContextualAssistantProposal } from "@/services/integrations/ai/contextual-assistant-contract";

type Props = {
  entityType: "task" | "course" | "note" | "course_material";
  entityId: string;
  entityTitle: string;
  onClose: () => void;
};

export function ContextualAssistantModal({
  entityType,
  entityId,
  entityTitle,
  onClose,
}: Props) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<
    Array<{ question: string; answer: ContextualAssistantProposal }>
  >([]);

  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      controller.current?.abort();
    };
  }, []);

  async function handleAsk(qToAsk?: string) {
    const q = (qToAsk ?? question).trim();
    if (!q) return;

    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;

    setLoading(true);
    setError(null);

    const companionConfig = getCompanionSession();

    try {
      const result = await generateRoutedProposal(
        "contextual_assistant",
        JSON.stringify({ entityType, entityId, question: q }),
        companionConfig,
        abort.signal,
      );

      if (abort.signal.aborted) return;

      if (!result.ok) {
        setError(result.message);
        setLoading(false);
        return;
      }

      const answer = ((result as unknown) as { ok: true; review: { answer: ContextualAssistantProposal } }).review.answer;
      setHistory((prev) => [...prev, { question: q, answer }]);
      setError(err instanceof Error ? err.message : "Failed to get answer.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        zIndex: 170,
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
          width: "min(100%, 42rem)",
          maxHeight: "min(50rem, calc(100svh - 2rem))",
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
              Contextual Assistant • {entityType.replace(/_/g, " ")}
            </p>
            <h3 style={{ margin: "0.2rem 0 0", fontSize: "1.1rem", fontWeight: 750, color: "var(--text-primary)" }}>
              {entityTitle}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: "2.25rem",
              height: "2.25rem",
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

        {/* Message Log */}
        <div style={{ flex: 1, overflowY: "auto", padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          {history.length === 0 && !loading && (
            <div style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--text-secondary)" }}>
              <HelpCircle size={32} style={{ color: "var(--accent-text)", margin: "0 auto 0.5rem" }} />
              <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600 }}>
                Ask any question about this {entityType.replace(/_/g, " ")}.
              </p>
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.78rem", color: "var(--text-tertiary)" }}>
                Responses are strictly grounded in this entity&apos;s text.
              </p>
            </div>
          )}

          {history.map((item, idx) => (
            <div key={idx} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {/* Question bubble */}
              <div
                style={{
                  alignSelf: "flex-end",
                  maxWidth: "85%",
                  padding: "0.65rem 0.95rem",
                  borderRadius: "var(--radius-md) var(--radius-md) 0 var(--radius-md)",
                  background: "var(--accent-muted)",
                  border: "1px solid var(--accent-border)",
                  color: "var(--accent-text)",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                }}
              >
                {item.question}
              </div>

              {/* Answer card */}
              <div
                style={{
                  alignSelf: "flex-start",
                  width: "100%",
                  padding: "1rem",
                  borderRadius: "var(--radius-md)",
                  background: "var(--surface)",
                  border: "1px solid var(--border-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.6rem",
                }}
              >
                <div style={{ fontSize: "0.88rem", lineHeight: 1.6, color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>
                  {item.answer.answer}
                </div>

                {item.answer.keyCitations.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", borderTop: "1px solid var(--border-subtle)", paddingTop: "0.6rem" }}>
                    <span style={{ fontSize: "0.72rem", fontWeight: 750, textTransform: "uppercase", color: "var(--text-secondary)" }}>
                      Citations
                    </span>
                    {item.answer.keyCitations.map((cit, cIdx) => (
                      <div key={cIdx} style={{ display: "flex", gap: "0.35rem", fontSize: "0.78rem", color: "var(--text-secondary)", fontStyle: "italic" }}>
                        <Quote size={12} style={{ flexShrink: 0, marginTop: 2, color: "var(--accent-text)" }} />
                        <span>{cit}</span>
                      </div>
                    ))}
                  </div>
                )}

                {item.answer.suggestedFollowUps && item.answer.suggestedFollowUps.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.3rem" }}>
                    {item.answer.suggestedFollowUps.map((fUp, fIdx) => (
                      <button
                        key={fIdx}
                        type="button"
                        onClick={() => void handleAsk(fUp)}
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.25rem 0.55rem",
                          borderRadius: "var(--radius-pill)",
                          border: "1px solid var(--border-subtle)",
                          background: "var(--surface-subtle)",
                          color: "var(--accent-text)",
                          cursor: "pointer",
                        }}
                      >
                        {fUp} →
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "1rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
              <Loader2 size={16} className="animate-spin" color="var(--accent-text)" />
              Reading entity context and crafting answer…
            </div>
          )}

          {error && (
            <div style={{ padding: "0.75rem", borderRadius: "var(--radius-sm)", background: "color-mix(in srgb, var(--destructive) 15%, transparent)", color: "var(--destructive)", fontSize: "0.82rem" }}>
              {error}
            </div>
          )}
        </div>

        {/* Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleAsk();
          }}
          style={{
            display: "flex",
            gap: "0.5rem",
            padding: "1rem 1.25rem",
            borderTop: "1px solid var(--border-subtle)",
            background: "var(--surface-subtle)",
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={`Ask about ${entityTitle}…`}
            disabled={loading}
            style={{
              flex: 1,
              padding: "0.6rem 0.85rem",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-subtle)",
              background: "var(--surface)",
              color: "var(--text-primary)",
              fontSize: "0.88rem",
            }}
          />
          <button
            type="submit"
            className="motion-tactile"
            disabled={loading || !question.trim()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              padding: "0.6rem 1rem",
              borderRadius: "var(--radius-md)",
              background: "var(--accent)",
              color: "var(--accent-foreground)",
              border: "none",
              fontSize: "0.85rem",
              fontWeight: 750,
              cursor: "pointer",
            }}
          >
            <Send size={15} /> Ask
          </button>
        </form>
      </div>
    </div>
  );
}
