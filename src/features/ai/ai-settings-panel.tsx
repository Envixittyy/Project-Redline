"use client";

import { CheckCircle2, Cpu, Laptop, RefreshCw, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Surface } from "@/components/ui/surface";
import type {
  AiPermissionMode,
  AiPreferences,
  AiProviderId,
  CloudFallbackMode,
  LocalProviderType,
} from "@/services/integrations/ai/types";

import {
  clearAiTransferHistoryAction,
  updateAiPreferencesAction,
} from "./ai-actions";
import { checkCompanionHealth, getCompanionStatus, pairCompanion, unpairCompanion } from "@/services/integrations/ai/companion-client";
import { clearCompanionSession, setCompanionSession } from "@/services/integrations/ai/companion-session";
import styles from "./ai-settings-panel.module.css";

type AiSettingsPanelProps = {
  preferences: AiPreferences;
};

export function AiSettingsPanel({ preferences }: AiSettingsPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  // Cloud preferences
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

  // Local Companion settings
  const [companionUrl, setCompanionUrl] = useState(
    preferences.localCompanionUrl || "http://127.0.0.1:41400",
  );
  const [localProvider, setLocalProvider] = useState<LocalProviderType>(
    preferences.localProvider || "ollama",
  );
  const [localEndpoint, setLocalEndpoint] = useState(
    preferences.localEndpoint || "http://127.0.0.1:11434",
  );
  const [localModel, setLocalModel] = useState(
    preferences.localModel || "qwen2.5:7b",
  );
  const [pairingSecret, setPairingSecret] = useState("");
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [pairingToken, setPairingToken] = useState<string | null>(
    null,
  );

  // Live status state
  const [companionRunning, setCompanionRunning] = useState<boolean | null>(null);
  const [runtimeConnected, setRuntimeConnected] = useState<boolean | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<Array<{ id: string; name: string }>>([]);
  const [companionError, setCompanionError] = useState<string | null>(null);

  useEffect(() => {
    if (!pairingToken || !pairingExpiresAt) { clearCompanionSession(); return; }
    setCompanionSession({ enabled: true, companionUrl, provider: localProvider, endpoint: localEndpoint, model: localModel, pairingToken }, pairingExpiresAt);
  }, [companionUrl, localProvider, localEndpoint, localModel, pairingToken, pairingExpiresAt]);

  // Update default endpoint when switching provider
  function handleProviderChange(provider: LocalProviderType) {
    setLocalProvider(provider);
    if (provider === "ollama") setLocalEndpoint("http://127.0.0.1:11434");
    else if (provider === "llamacpp") setLocalEndpoint("http://127.0.0.1:8080");
    else if (provider === "openai_compatible") setLocalEndpoint("http://127.0.0.1:1234/v1");
  }

  async function checkStatus() {
    const health = await checkCompanionHealth(companionUrl);
    setCompanionRunning(health.ok);

    if (!health.ok) {
      setCompanionError(health.error || "Companion daemon is offline.");
      setRuntimeConnected(false);
      return;
    }

    if (pairingToken) {
      const status = await getCompanionStatus({
        enabled: true,
        companionUrl,
        provider: localProvider,
        endpoint: localEndpoint,
        model: localModel,
        pairingToken,
      });
      setRuntimeConnected(status.runtimeConnected);
      if (!status.paired) setPairingToken(null);
      setDiscoveredModels(status.models);
      if (status.error) setCompanionError(status.error);
      else setCompanionError(null);
    } else {
      setCompanionError(null);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadStatus() {
      const health = await checkCompanionHealth(companionUrl);
      if (!active) return;
      setCompanionRunning(health.ok);

      if (!health.ok) {
        setCompanionError(health.error || "Companion daemon is offline.");
        setRuntimeConnected(false);
        return;
      }

      if (pairingToken) {
        const status = await getCompanionStatus({
          enabled: true,
          companionUrl,
          provider: localProvider,
          endpoint: localEndpoint,
          model: localModel,
          pairingToken,
        });
        if (!active) return;
        setRuntimeConnected(status.runtimeConnected);
        if (!status.paired) setPairingToken(null);
        setDiscoveredModels(status.models);
        if (status.error) setCompanionError(status.error);
        else setCompanionError(null);
      } else {
        setCompanionError(null);
      }
    }

    // Local-network permission should be requested by an explicit user action.
    if (pairingToken) void loadStatus();

    return () => {
      active = false;
    };
  }, [companionUrl, localProvider, localEndpoint, localModel, pairingToken]);

  async function handlePair(e: React.FormEvent) {
    e.preventDefault();
    if (!pairingSecret.trim()) return;

    startTransition(async () => {
      const res = await pairCompanion(companionUrl, pairingSecret.trim());
      if (res.ok && res.token) {
        setPairingToken(res.token);
        setPairingExpiresAt(res.expiresAt!);
        setCompanionSession({ enabled: true, companionUrl, provider: localProvider, endpoint: localEndpoint, model: localModel, pairingToken: res.token }, res.expiresAt!);
        setMessage("Companion paired successfully.");
        setCompanionError(null);
        setPairingSecret("");
      } else {
        setCompanionError(res.error || "Pairing failed.");
      }
    });
  }

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
      {/* 1. Local AI Companion Panel */}
      <Surface variant="glass" className={styles.card}>
        <header className={styles.header}>
          <Laptop size={22} color="var(--accent-text)" />
          <div>
            <h2>Local AI Companion (Phase 10A)</h2>
            <p>Available on this PC only. Hosted desktop browsers may ask for local network permission. iPhone cannot reach the PC companion.</p>
          </div>
          <div className={styles.statusBadge}>
            {companionRunning === true ? (
              pairingToken && runtimeConnected ? (
                <span className={styles.badgeSuccess}>
                  <CheckCircle2 size={14} /> Ready
                </span>
              ) : pairingToken ? (
                <span className={styles.badgeWarning}>Runtime Offline</span>
              ) : (
                <span className={styles.badgeWarning}>Pairing Required</span>
              )
            ) : companionRunning === false ? (
              <span className={styles.badgeError}>
                <XCircle size={14} /> Disconnected
              </span>
            ) : (
              <span className={styles.badgeMuted}>Not checked</span>
            )}
          </div>
        </header>

        <div className={styles.form}>
          <label className={styles.field}>
            Companion Loopback URL
            <input
              className={styles.input}
              type="text"
              value={companionUrl}
              onChange={(e) => setCompanionUrl(e.target.value)}
              placeholder="http://127.0.0.1:41400"
            />
            <span className={styles.fieldHint}>
              Controlled localhost security boundary (127.0.0.1 only).
            </span>
          </label>

          <div className={styles.twoColumn}>
            <label className={styles.field}>
              Local Runtime Provider
              <select
                className={styles.select}
                value={localProvider}
                onChange={(e) => handleProviderChange(e.target.value as LocalProviderType)}
              >
                <option value="ollama">Ollama (Default :11434)</option>
                <option value="llamacpp">llama.cpp Server (Default :8080)</option>
                <option value="openai_compatible">OpenAI-Compatible Local (LM Studio, LocalAI)</option>
              </select>
            </label>

            <label className={styles.field}>
              Runtime Endpoint
              <input
                className={styles.input}
                type="text"
                value={localEndpoint}
                onChange={(e) => setLocalEndpoint(e.target.value)}
                placeholder="http://127.0.0.1:11434"
              />
            </label>
          </div>

          <label className={styles.field}>
            Model Name / ID
            {discoveredModels.length > 0 ? (
              <select
                className={styles.select}
                value={localModel}
                onChange={(e) => setLocalModel(e.target.value)}
              >
                {discoveredModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={styles.input}
                type="text"
                value={localModel}
                onChange={(e) => setLocalModel(e.target.value)}
                placeholder="e.g. qwen2.5:7b, llama-3.2-3b"
              />
            )}
            <span className={styles.fieldHint}>
              {discoveredModels.length > 0
                ? `${discoveredModels.length} models discovered from local runtime.`
                : "Enter model tag (e.g. qwen2.5:7b)."}
            </span>
          </label>

          {/* Pairing control */}
          {!pairingToken ? (
            <form onSubmit={handlePair} className={styles.pairSection}>
              <div className={styles.field}>
                <strong>Pair Companion Daemon</strong>
                <span className={styles.fieldHint}>
                  Run <code>pnpm companion</code> in an interactive terminal and copy the pairing secret below.
                </span>
                <div className={styles.pairInputRow}>
                  <input
                    className={styles.input}
                    type="password"
                    value={pairingSecret}
                    onChange={(e) => setPairingSecret(e.target.value)}
                    placeholder="Enter companion pairing secret"
                  />
                  <button className={styles.buttonPrimary} type="submit" disabled={pending || !pairingSecret}>
                    Pair
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <div className={styles.pairedRow}>
              <span className={styles.pairedText}>✓ Paired with ephemeral token</span>
              <button
                className={styles.buttonSecondary}
                type="button"
                onClick={() => {
                  const token = pairingToken;
                  setPairingToken(null);
                  clearCompanionSession();
                  void unpairCompanion(companionUrl, token).then(result => setMessage(result.message));
                }}
              >
                Unpair
              </button>
            </div>
          )}

          <div className={styles.actions}>
            <button
              className={styles.buttonSecondary}
              type="button"
              onClick={checkStatus}
              disabled={pending}
            >
              <RefreshCw size={16} /> Test Connection
            </button>
          </div>

          {companionError ? (
            <p className={styles.errorMessage} role="alert">
              {companionError}
            </p>
          ) : null}
        </div>
      </Surface>

      {/* 2. Cloud AI Privacy & Settings Panel */}
      <Surface variant="glass" className={styles.card}>
        <header className={styles.header}>
          <Cpu size={22} color="var(--accent-text)" />
          <div>
            <h2>Cloud AI Privacy & Settings (Phase 9)</h2>
            <p>Cloud dispatch is paused for trust migration. Saved cloud preferences do not enable requests. The mutation policy also applies to local proposals.</p>
          </div>
        </header>

        <form className={styles.form} onSubmit={handleSave}>
          <div className={styles.toggleRow}>
            <div>
              <strong>Enable Cloud AI</strong>
              <div className={styles.fieldHint}>
                Cloud transfers are currently disabled regardless of this saved preference.
              </div>
            </div>
            <input
              type="checkbox"
              checked={cloudEnabled}
              disabled
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

      {/* 3. Data Retention & Audit */}
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
