"use client";

import { Cpu, ShieldCheck, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Surface } from "@/components/ui/surface";
import type {
  AiPermissionMode,
  AiPreferences,
  AiProviderId,
  CloudFallbackMode,
} from "@/services/integrations/ai/types";

import { clearAiTransferHistoryAction, updateAiPreferencesAction } from "./ai-actions";
import styles from "./ai-settings-panel.module.css";

type AiSettingsPanelProps = {
  preferences: AiPreferences;
};

export function AiSettingsPanel({ preferences }: AiSettingsPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const [cloudEnabled, setCloudEnabled] = useState(preferences.cloudEnabled);
  const [defaultProvider, setDefaultProvider] = useState<AiProviderId>(
    preferences.defaultProvider || "anthropic",
  );
  const [fallbackMode, setFallbackMode] = useState<CloudFallbackMode>(
    preferences.cloudFallbackMode,
  );
  const [permissionMode, setPermissionMode] = useState<AiPermissionMode>(
    preferences.permissionMode,
  );

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateAiPreferencesAction({
        cloudEnabled,
        defaultProvider,
        cloudFallbackMode: fallbackMode,
        permissionMode,
      });
      setMessage(res.message);
      router.refresh();
    });
  }

  function handleClearHistory() {
    if (!window.confirm("Clear all AI transfer audit metadata? This will not affect created tasks or notes.")) {
      return;
    }
    startTransition(async () => {
      const res = await clearAiTransferHistoryAction();
      setMessage(res.message);
      router.refresh();
    });
  }

  return (
    <div className={styles.layout}>
      <Surface variant="glass" className={styles.card}>
        <header className={styles.header}>
          <Cpu size={22} color="var(--accent-text)" />
          <div>
            <h2>Cloud AI Privacy & Settings</h2>
            <p>Configure optional cloud model assistance, fallback modes, and permission boundaries.</p>
          </div>
        </header>

        <form className={styles.form} onSubmit={handleSave}>
          <div className={styles.toggleRow}>
            <div>
              <strong>Enable Cloud AI</strong>
              <div className={styles.fieldHint}>
                When disabled, all cloud requests are strictly denied.
              </div>
            </div>
            <input
              type="checkbox"
              checked={cloudEnabled}
              onChange={(e) => setCloudEnabled(e.target.checked)}
              style={{ width: "1.25rem", height: "1.25rem" }}
            />
          </div>

          <label className={styles.field}>
            Default Cloud Provider
            <select
              className={styles.select}
              value={defaultProvider}
              onChange={(e) => setDefaultProvider(e.target.value as AiProviderId)}
              disabled={!cloudEnabled}
            >
              <option value="anthropic">Anthropic (Claude 3.5 Sonnet)</option>
              <option value="gemini">Google (Gemini 2.0 Flash)</option>
              <option value="openai">OpenAI (GPT-4o mini)</option>
            </select>
          </label>

          <label className={styles.field}>
            Cloud Consent Mode
            <select
              className={styles.select}
              value={fallbackMode}
              onChange={(e) => setFallbackMode(e.target.value as CloudFallbackMode)}
              disabled={!cloudEnabled}
            >
              <option value="ask_each_time">Ask each time (Interactive disclosure & one-time consent)</option>
              <option value="off">Off (Deny all cloud transfer requests)</option>
              <option value="automatic_on_low_confidence">Prompt on low confidence</option>
            </select>
            <span className={styles.fieldHint}>
              Every transfer containing private app data requires interactive one-time consent.
            </span>
          </label>

          <label className={styles.field}>
            Mutation Permission Policy
            <select
              className={styles.select}
              value={permissionMode}
              onChange={(e) => setPermissionMode(e.target.value as AiPermissionMode)}
              disabled={!cloudEnabled}
            >
              <option value="ask_before_changing">Ask before changing (Review proposal before commit)</option>
              <option value="suggest_only">Suggest only (Do not enable mutation commits)</option>
            </select>
          </label>

          <div className={styles.actions}>
            <button className={styles.buttonPrimary} type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save Preferences"}
            </button>
          </div>
        </form>

        {message ? (
          <p role="status" className={styles.message}>
            {message}
          </p>
        ) : null}
      </Surface>

      <Surface variant="base" className={styles.card}>
        <header className={styles.header}>
          <ShieldCheck size={20} />
          <div>
            <h2>Data Retention & Audit</h2>
            <p>Transfer metadata is stored without raw prompts or outputs and automatically expires in 30 days.</p>
          </div>
        </header>

        <div className={styles.actions}>
          <button
            className={styles.buttonDanger}
            type="button"
            disabled={pending}
            onClick={handleClearHistory}
          >
            <Trash2 size={16} />
            Clear AI Transfer History Now
          </button>
        </div>
      </Surface>
    </div>
  );
}
