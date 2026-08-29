"use client";

import { AlertTriangle, ExternalLink, ShieldCheck } from "lucide-react";

import { Surface } from "@/components/ui/surface";
import { getModelDescriptor } from "@/services/integrations/ai/adapters/provider-router";
import type { AiTransferManifest } from "@/services/integrations/ai/types";

import styles from "./ai-disclosure-modal.module.css";

type AiDisclosureModalProps = {
  manifest: AiTransferManifest;
  onConsentAndSend: () => void;
  onCancel: () => void;
  pending?: boolean;
};

export function AiDisclosureModal({
  manifest,
  onConsentAndSend,
  onCancel,
  pending = false,
}: AiDisclosureModalProps) {
  const descriptor = getModelDescriptor(manifest.provider, manifest.model);

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="ai-modal-title">
      <Surface variant="glass" className={styles.modal}>
        <header className={styles.header}>
          <ShieldCheck size={24} color="var(--accent-text)" />
          <div>
            <h2 id="ai-modal-title">Cloud AI Data Transfer</h2>
            <p>One-time consent required for private data egress</p>
          </div>
        </header>

        <div className={styles.details}>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Destination Provider</span>
            <div className={styles.detailValue}>
              <strong>{descriptor.name}</strong> ({manifest.provider.toUpperCase()})
              <div>
                <a
                  href={descriptor.privacyInfoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.privacyLink}
                >
                  Provider Privacy Policy <ExternalLink size={12} />
                </a>
              </div>
            </div>
          </div>

          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Stated Purpose</span>
            <span className={styles.detailValue}>{manifest.purpose}</span>
          </div>

          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Included App Sources</span>
            <span className={styles.detailValue}>{manifest.sourceCount} item(s)</span>
          </div>

          {manifest.sourceReferences.length > 0 ? (
            <ul className={styles.sourcesList}>
              {manifest.sourceReferences.map((ref) => (
                <li key={ref.entityId} className={styles.sourceItem}>
                  {ref.label}
                </li>
              ))}
            </ul>
          ) : null}

          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Allowlisted Fields</span>
            <span className={styles.detailValue}>
              {manifest.allowListedFields.join(", ") || "None"}
            </span>
          </div>

          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Payload Size</span>
            <span className={styles.detailValue}>{manifest.textByteCount} bytes</span>
          </div>

          <div>
            <span className={styles.detailLabel}>Canonical Payload Digest (SHA-256)</span>
            <div className={styles.digestText}>{manifest.canonicalPayloadDigest}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
          <AlertTriangle size={16} />
          <span>
            Consent is valid for this exact request only. Approving transfer does NOT authorize automatic mutations.
          </span>
        </div>

        <footer className={styles.actions}>
          <button
            className={styles.cancelButton}
            type="button"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className={styles.sendButton}
            type="button"
            disabled={pending}
            onClick={onConsentAndSend}
          >
            {pending ? "Sending..." : "Send once"}
          </button>
        </footer>
      </Surface>
    </div>
  );
}
