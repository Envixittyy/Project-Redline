"use client";

import {
  CheckCircle2,
  Cpu,
  Laptop,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Surface } from "@/components/ui/surface";
import { Toggle } from "@/components/ui/toggle";
import { Select } from "@/components/ui/select";
import type {
  AiPermissionMode,
  AiPreferences,
  CloudFallbackMode,
  LocalProviderType,
} from "@/services/integrations/ai/types";

import {
  clearAiTransferHistoryAction,
  updateAiPreferencesAction,
} from "./ai-actions";
import {
  checkCompanionHealth,
  getCompanionStatus,
  pairCompanion,
  unpairCompanion,
} from "@/services/integrations/ai/companion-client";
import {
  clearCompanionSession,
  setCompanionSession,
} from "@/services/integrations/ai/companion-session";
import styles from "./ai-settings-panel.module.css";
import type { AiMode, CloudProvider } from "@/services/integrations/ai/routing-contract";

type AiSettingsPanelProps = {
  preferences: AiPreferences;
  providers?: Record<CloudProvider, { configured: boolean; model: string | null; status: string }>;
};

export function AiSettingsPanel({ preferences, providers }: AiSettingsPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  // Cloud preferences
  const [cloudEnabled, setCloudEnabled] = useState(preferences.cloudEnabled);
  const [defaultProvider, setDefaultProvider] = useState<CloudProvider>(
    preferences.preferredCloud || "gemini",
  );
  const [aiMode, setAiMode] = useState<AiMode>(preferences.aiMode ?? "auto");
  const [secondaryCloud, setSecondaryCloud] = useState(preferences.secondaryCloud ?? false);
  const [checklistCloud, setChecklistCloud] = useState(preferences.checklistCloud ?? false);
  const [courseImportCloud, setCourseImportCloud] = useState(
    preferences.courseImportCloud ?? false,
  );
  const remoteOrigin = process.env.NEXT_PUBLIC_COMPANION_REMOTE_ORIGIN;
  const [fallbackMode, setFallbackMode] = useState<CloudFallbackMode>(
    preferences.cloudFallbackMode === "off" ? "off" : "ask_each_time",
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
  const [pairingToken, setPairingToken] = useState<string | null>(null);

  // Live status state
  const [companionRunning, setCompanionRunning] = useState<boolean | null>(null);
  const [runtimeConnected, setRuntimeConnected] = useState<boolean | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<Array<{ id: string; name: string }>>([]);
  const [companionError, setCompanionError] = useState<string | null>(null);

  useEffect(() => {
    if (!pairingToken || !pairingExpiresAt) {
      clearCompanionSession();
      return;
    }
    setCompanionSession(
      {
        enabled: true,
        companionUrl,
        provider: localProvider,
        endpoint: localEndpoint,
        model: localModel,
        pairingToken,
      },
      pairingExpiresAt,
    );
  }, [companionUrl, localProvider, localEndpoint, localModel, pairingToken, pairingExpiresAt]);

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
        setPairingExpiresAt(res.expiresAt ?? null);
        setCompanionSession(
          {
            enabled: true,
            companionUrl,
            provider: localProvider,
            endpoint: localEndpoint,
            model: localModel,
            pairingToken: res.token,
          },
          res.expiresAt ?? "",
        );
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
    setMessage(null);
    startTransition(async () => {
      const res = await updateAiPreferencesAction({
        cloudEnabled,
        preferredCloud: defaultProvider,
        aiMode,
        secondaryCloud,
        checklistCloud,
        courseImportCloud,
        cloudFallbackMode: fallbackMode,
        permissionMode,
      });
      setMessage(res.message);
      router.refresh();
    });
  }

  function handleClearHistory() {
    if (!window.confirm("Clear all legacy cloud transfer audit records?")) return;
    setMessage(null);
    startTransition(async () => {
      const res = await clearAiTransferHistoryAction();
      setMessage(res.message);
      router.refresh();
    });
  }

  return (
    <div className={styles.layout}>
      {/* 1. Local AI Companion Panel */}
      <Surface variant="base" className={styles.card}>
        <header className={styles.header}>
          <div className={styles.headerIcon}>
            <Laptop size={20} aria-hidden="true" />
          </div>
          <div className={styles.headerTitleGroup}>
            <h2>Local / Remote Companion</h2>
            <p>
              Same-PC loopback, or the configured home PC over private Tailscale HTTPS. Other
              devices require Tailscale, pairing, and a running home PC. No public runtime ports.
            </p>
          </div>
          <div className={styles.statusBadge}>
            {companionRunning === true ? (
              pairingToken && runtimeConnected ? (
                <Badge tone="success" size="sm" icon={<CheckCircle2 size={13} />}>
                  Ready
                </Badge>
              ) : pairingToken ? (
                <Badge tone="warning" size="sm">
                  Runtime Offline
                </Badge>
              ) : (
                <Badge tone="warning" size="sm">
                  Pairing Required
                </Badge>
              )
            ) : companionRunning === false ? (
              <Badge tone="destructive" size="sm" icon={<XCircle size={13} />}>
                Disconnected
              </Badge>
            ) : (
              <Badge tone="neutral" size="sm">
                Not checked
              </Badge>
            )}
          </div>
        </header>

        <div className={styles.form}>
          <label className={styles.field}>
            Companion transport
            <Select
              value={companionUrl}
              disabled={!!pairingToken}
              onChange={(value) => {
                setCompanionUrl(value);
                setCompanionRunning(null);
                setRuntimeConnected(null);
              }}
              options={[
                { value: "http://127.0.0.1:41400", label: "Same PC · loopback" },
                ...(remoteOrigin
                  ? [{ value: remoteOrigin, label: "Home PC · private Tailscale" }]
                  : []),
              ]}
            />
            <span className={styles.fieldHint}>
              {companionUrl}. Unpair before switching. Remote address is configured by the server
              operator, not browser input.
            </span>
          </label>

          <div className={styles.twoColumn}>
            <label className={styles.field}>
              Local Runtime Provider
              <Select
                value={localProvider}
                onChange={(value) => handleProviderChange(value as LocalProviderType)}
                options={[
                  { value: "ollama", label: "Ollama (Default :11434)" },
                  { value: "llamacpp", label: "llama.cpp Server (Default :8080)" },
                  { value: "openai_compatible", label: "OpenAI-Compatible Local (LM Studio, LocalAI)" },
                ]}
              />
            </label>

            <label className={styles.field}>
              Runtime configuration assertion (home-PC loopback)
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
              <Select
                value={localModel}
                onChange={setLocalModel}
                options={discoveredModels.map((model) => ({
                  value: model.id,
                  label: model.name,
                }))}
              />
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
                  Run <code>pnpm companion</code> on the home PC. Copy the pairing code matching
                  this transport. It expires after five minutes.
                </span>
                <div className={styles.pairInputRow}>
                  <input
                    className={styles.input}
                    type="password"
                    value={pairingSecret}
                    onChange={(e) => setPairingSecret(e.target.value)}
                    placeholder="Enter companion pairing secret"
                    style={{ flex: 1, minWidth: "14rem" }}
                  />
                  <Button
                    variant="primary"
                    size="md"
                    type="submit"
                    disabled={pending || !pairingSecret}
                  >
                    Pair
                  </Button>
                </div>
              </div>
            </form>
          ) : (
            <div className={styles.pairedRow}>
              <span className={styles.pairedText}>✓ Paired with ephemeral token</span>
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  const token = pairingToken;
                  setPairingToken(null);
                  clearCompanionSession();
                  void unpairCompanion(companionUrl, token).then((result) =>
                    setMessage(result.message),
                  );
                }}
              >
                Unpair
              </Button>
            </div>
          )}

          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="md"
              icon={<RefreshCw size={14} />}
              onClick={checkStatus}
              disabled={pending}
            >
              Test Connection
            </Button>
          </div>

          {companionError ? (
            <Callout variant="error" role="alert">
              {companionError}
            </Callout>
          ) : null}
        </div>
      </Surface>

      {/* 2. Cloud AI Privacy & Settings Panel */}
      <Surface variant="base" className={styles.card}>
        <header className={styles.header}>
          <div className={styles.headerIcon}>
            <Cpu size={20} aria-hidden="true" />
          </div>
          <div className={styles.headerTitleGroup}>
            <h2>AI Routing & Privacy</h2>
            <p>
              Provider choice changes inference, never permissions. Only checklist and course-import
              capabilities are enabled. Every cloud transfer asks first.
            </p>
          </div>
        </header>

        <form className={styles.form} onSubmit={handleSave}>
          <label className={styles.field}>
            AI Mode
            <Select
              value={aiMode}
              onChange={(value) => setAiMode(value as AiMode)}
              options={[
                { value: "auto", label: "Auto · local first" },
                { value: "local", label: "Local only" },
                { value: "gemini", label: "Gemini" },
                { value: "openrouter", label: "OpenRouter" },
              ]}
            />
          </label>

          <Toggle
            label="Enable Cloud AI"
            description="Allow cloud offers for enabled capabilities. This is not transfer consent."
            checked={cloudEnabled}
            onChange={(e) => setCloudEnabled(e.target.checked)}
          />

          <label className={styles.field}>
            Default Cloud Provider
            <Select
              value={defaultProvider}
              onChange={(value) => setDefaultProvider(value as CloudProvider)}
              disabled={!cloudEnabled}
              options={[
                { value: "gemini", label: "Gemini" },
                { value: "openrouter", label: "OpenRouter" },
              ]}
            />
          </label>

          <label className={styles.field}>
            Cloud Consent Mode
            <Select
              value={fallbackMode}
              onChange={(value) => setFallbackMode(value as CloudFallbackMode)}
              disabled={!cloudEnabled}
              options={[
                { value: "ask_each_time", label: "Ask each time (Interactive disclosure & one-time consent)" },
                { value: "off", label: "Off (Deny all cloud transfer requests)" },
              ]}
            />
            <span className={styles.fieldHint}>
              Every transfer containing private app data requires interactive one-time consent.
            </span>
          </label>

          <Toggle
            label="Secondary Cloud Provider Offer"
            description="Offer secondary cloud provider after an infrastructure failure (Auto only)."
            checked={secondaryCloud}
            disabled={!cloudEnabled}
            onChange={(e) => setSecondaryCloud(e.target.checked)}
          />

          <Toggle
            label="Task Checklists Cloud Disclosure"
            description="Allow cloud offers for task checklist generation."
            checked={checklistCloud}
            disabled={!cloudEnabled}
            onChange={(e) => setChecklistCloud(e.target.checked)}
          />

          <Toggle
            label="Selected Course Text Cloud Disclosure"
            description="Allow cloud offers for selected course text import."
            checked={courseImportCloud}
            disabled={!cloudEnabled}
            onChange={(e) => setCourseImportCloud(e.target.checked)}
          />

          <Callout variant="neutral">
            Fallback availability:{" "}
            {cloudEnabled && fallbackMode !== "off" && (checklistCloud || courseImportCloud)
              ? "may be offered for enabled capabilities; fresh consent required."
              : "disabled."}{" "}
            Unknown/private future domains are local-only. Model IDs and keys are configured on the
            server.
          </Callout>

          {providers ? (
            <div className={styles.fieldHint}>
              {(["gemini", "openrouter"] as const).map((p) => (
                <span key={p} style={{ display: "block" }}>
                  {p}:{" "}
                  {providers[p].configured
                    ? `configured · ${providers[p].model} · online status not checked`
                    : "not configured"}
                </span>
              ))}
            </div>
          ) : null}

          <label className={styles.field}>
            Mutation Permission Policy
            <Select
              value={permissionMode}
              onChange={(value) => setPermissionMode(value as AiPermissionMode)}
              options={[
                { value: "ask_before_changing", label: "Ask before changing (Review proposal before commit)" },
                { value: "suggest_only", label: "Suggest only (Do not enable mutation commits)" },
              ]}
            />
          </label>

          <div className={styles.actions}>
            <Button variant="primary" size="md" type="submit" disabled={pending} loading={pending}>
              {pending ? "Saving…" : "Save Preferences"}
            </Button>
          </div>
        </form>

        {message ? (
          <Callout variant="info" role="status">
            {message}
          </Callout>
        ) : null}
      </Surface>

      {/* 3. Data Retention & Audit */}
      <Surface variant="base" className={styles.card}>
        <header className={styles.header}>
          <div className={styles.headerIcon}>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className={styles.headerTitleGroup}>
            <h2>Data Retention & Audit</h2>
            <p>
              New routing metadata and reviewed proposals remain in the protected audit. Course
              source text is retained there too. Five-minute expiry stops execution; it does not
              erase content. This button clears legacy cloud history only.
            </p>
          </div>
        </header>

        <div className={styles.actions}>
          <Button
            variant="destructive"
            size="md"
            icon={<Trash2 size={14} />}
            disabled={pending}
            onClick={handleClearHistory}
          >
            Clear Legacy Cloud Transfer History
          </Button>
        </div>
      </Surface>
    </div>
  );
}
