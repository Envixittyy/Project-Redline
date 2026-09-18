"use client";

import { ModalFrame } from "@/components/ui/modal-frame";
import type {
  DearDumbassRepository,
  DearDumbassSyncConflict,
  DearDumbassSyncState,
} from "@/services/dear-dumbass";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Key,
  Lock,
  RefreshCw,
  ShieldCheck,
  Unlock,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./sync-modal.module.css";

export interface SyncModalProps {
  repository: DearDumbassRepository;
  onClose: () => void;
}

export function SyncModal({ repository, onClose }: SyncModalProps) {
  const coordinator = repository.getSyncCoordinator();
  const [syncState, setSyncState] = useState<DearDumbassSyncState>(coordinator.getState());
  const [conflicts, setConflicts] = useState<DearDumbassSyncConflict[]>([]);

  // Setup state
  const [setupPassphrase, setSetupPassphrase] = useState("");
  const [confirmSetupPassphrase, setConfirmSetupPassphrase] = useState("");
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Unlock state
  const [unlockPassphrase, setUnlockPassphrase] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // Sync action state
  const [isSyncingNow, setIsSyncingNow] = useState(false);
  const [isLocking, setIsLocking] = useState(false);

  const mountedRef = useRef(true);

  const refreshDetailedState = useCallback(async () => {
    try {
      const [detailed, rawConflicts] = await Promise.all([
        coordinator.getDetailedState(),
        coordinator.getConflicts(),
      ]);
      if (mountedRef.current) {
        setSyncState(detailed);
        setConflicts(rawConflicts);
      }
    } catch {
      // Ignored
    }
  }, [coordinator]);

  useEffect(() => {
    mountedRef.current = true;
    let isCancelled = false;

    void Promise.all([
      coordinator.getDetailedState(),
      coordinator.getConflicts(),
    ]).then(([detailed, rawConflicts]) => {
      if (!isCancelled) {
        setSyncState(detailed);
        setConflicts(rawConflicts);
      }
    });

    const unsubscribe = coordinator.subscribe((newState) => {
      if (mountedRef.current) {
        setSyncState(newState);
        void refreshDetailedState();
      }
    });

    return () => {
      isCancelled = true;
      mountedRef.current = false;
      unsubscribe();
    };
  }, [coordinator, refreshDetailedState]);

  const handleSetupSync = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupError(null);

    if (setupPassphrase.length < 8) {
      setSetupError("Passphrase must be at least 8 characters long.");
      return;
    }
    if (setupPassphrase !== confirmSetupPassphrase) {
      setSetupError("Passphrases do not match.");
      return;
    }

    setIsSettingUp(true);
    try {
      await coordinator.enableSync(setupPassphrase);
      setSetupPassphrase("");
      setConfirmSetupPassphrase("");
      await refreshDetailedState();
    } catch (err: unknown) {
      if (mountedRef.current) {
        setSetupError(
          err instanceof Error
            ? err.message
            : "Failed to configure encrypted sync.",
        );
      }
    } finally {
      if (mountedRef.current) {
        setIsSettingUp(false);
      }
    }
  };

  const handleUnlockSync = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlockError(null);

    if (!unlockPassphrase) {
      setUnlockError("Please enter your passphrase.");
      return;
    }

    setIsUnlocking(true);
    try {
      await coordinator.unlockSync(unlockPassphrase);
      setUnlockPassphrase("");
      await refreshDetailedState();
    } catch (err: unknown) {
      if (mountedRef.current) {
        setUnlockError(
          err instanceof Error
            ? err.message
            : "Incorrect passphrase. Could not unlock journal.",
        );
      }
    } finally {
      if (mountedRef.current) {
        setIsUnlocking(false);
      }
    }
  };

  const handleSyncNow = async () => {
    setIsSyncingNow(true);
    try {
      await coordinator.triggerSync();
      await refreshDetailedState();
    } catch {
      // Error reflected in state
    } finally {
      if (mountedRef.current) {
        setIsSyncingNow(false);
      }
    }
  };

  const handleLockDevice = async () => {
    setIsLocking(true);
    try {
      await coordinator.lock();
      await refreshDetailedState();
    } finally {
      if (mountedRef.current) {
        setIsLocking(false);
      }
    }
  };

  const handleResolveConflict = async (
    recordId: string,
    resolution: "local" | "remote",
  ) => {
    await coordinator.resolveConflict(recordId, resolution);
    await refreshDetailedState();
  };

  const getStatusBadge = () => {
    switch (syncState.status) {
      case "synced":
        return (
          <span className={`${styles.statusBadge} ${styles.badgeSynced}`}>
            <CheckCircle2 size={13} aria-hidden="true" />
            <span>Synced</span>
          </span>
        );
      case "syncing":
        return (
          <span className={`${styles.statusBadge} ${styles.badgeSyncing}`}>
            <RefreshCw size={13} className="animate-spin" aria-hidden="true" />
            <span>Syncing…</span>
          </span>
        );
      case "saved_locally":
        return (
          <span className={`${styles.statusBadge} ${styles.badgeWaiting}`}>
            <CloudOff size={13} aria-hidden="true" />
            <span>Saved locally ({syncState.pendingCount} pending)</span>
          </span>
        );
      case "waiting_to_sync":
        return (
          <span className={`${styles.statusBadge} ${styles.badgeWaiting}`}>
            <CloudOff size={13} aria-hidden="true" />
            <span>Waiting to sync (Offline)</span>
          </span>
        );
      case "locked":
        return (
          <span className={`${styles.statusBadge} ${styles.badgeLocked}`}>
            <Lock size={13} aria-hidden="true" />
            <span>Locked</span>
          </span>
        );
      case "conflict":
        return (
          <span className={`${styles.statusBadge} ${styles.badgeError}`}>
            <AlertTriangle size={13} aria-hidden="true" />
            <span>{syncState.conflictCount} Conflict(s)</span>
          </span>
        );
      case "error":
        return (
          <span className={`${styles.statusBadge} ${styles.badgeError}`}>
            <AlertCircle size={13} aria-hidden="true" />
            <span>Sync Error</span>
          </span>
        );
      case "local_only":
      default:
        return (
          <span className={`${styles.statusBadge} ${styles.badgeLocal}`}>
            <ShieldCheck size={13} aria-hidden="true" />
            <span>Local Only</span>
          </span>
        );
    }
  };

  return (
    <ModalFrame
      label="End-to-End Encrypted Sync"
      className={`${styles.panel} motion-enter`}
      onClose={onClose}
    >
      {/* Header */}
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <h2 id="sync-title" className={styles.title}>
              <Cloud size={18} aria-hidden="true" />
              <span>Encrypted Multi-Device Sync</span>
            </h2>
            <p className={styles.subtitle}>
              End-to-end encrypted journal synchronization with zero server knowledge.
            </p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close sync modal"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Privacy Boundary Alert */}
        <div className={styles.privacyAlert}>
          <strong>Zero-Knowledge Security Contract</strong>
          Dear Dumbass posts, replies, search terms, and encryption keys never leave your devices
          in plaintext. Cloud infrastructure stores only authenticated ciphertext (AES-256-GCM)
          and opaque synchronization sequences.
        </div>

        {/* Current Status Section */}
        <section className={styles.section} aria-label="Sync status">
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>
              <RefreshCw size={15} aria-hidden="true" />
              <span>Current Status</span>
            </h3>
            {getStatusBadge()}
          </div>

          {syncState.lastSyncedAt ? (
            <p className={styles.description}>
              Last synced: {new Date(syncState.lastSyncedAt).toLocaleString()}
            </p>
          ) : null}

          {syncState.errorMessage ? (
            <div className={styles.errorBox} role="alert">
              <span>{syncState.errorMessage}</span>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleSyncNow}
                disabled={isSyncingNow}
              >
                Retry
              </button>
            </div>
          ) : null}

          {syncState.isUnlocked ? (
            <div className={styles.buttonRow}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleSyncNow}
                disabled={isSyncingNow}
              >
                <RefreshCw size={14} aria-hidden="true" />
                <span>{isSyncingNow ? "Syncing…" : "Sync Now"}</span>
              </button>
              <button
                type="button"
                className={styles.dangerButton}
                onClick={handleLockDevice}
                disabled={isLocking}
                title="Remove encryption key from this device"
              >
                <Lock size={14} aria-hidden="true" />
                <span>Lock on this Device</span>
              </button>
            </div>
          ) : null}
        </section>

        {/* Setup Section (When sync is not yet enabled) */}
        {syncState.status === "local_only" ? (
          <section className={styles.section} aria-label="Enable sync">
            <h3 className={styles.sectionTitle}>
              <Key size={15} aria-hidden="true" />
              <span>Enable Encrypted Sync</span>
            </h3>
            <p className={styles.description}>
              Create an encryption passphrase. This passphrase will derive your master key using
              PBKDF2-HMAC-SHA-256 (600,000 rounds). Your passphrase is never transmitted or saved to
              any server.
            </p>

            <div className={styles.warningBox} role="alert">
              <strong>Important Recovery Notice</strong>
              If you forget this passphrase, your encrypted cloud data CANNOT be recovered by anyone.
            </div>

            <form onSubmit={handleSetupSync} className={styles.formGroup}>
              {setupError ? (
                <div className={styles.errorBox} role="alert">
                  <span>{setupError}</span>
                </div>
              ) : null}

              <div className={styles.formGroup}>
                <label htmlFor="setup-passphrase" className={styles.label}>
                  Master Passphrase (min 8 chars)
                </label>
                <input
                  id="setup-passphrase"
                  type="password"
                  className={styles.input}
                  value={setupPassphrase}
                  onChange={(e) => setSetupPassphrase(e.target.value)}
                  placeholder="Enter a strong passphrase…"
                  disabled={isSettingUp}
                  required
                  minLength={8}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="confirm-setup-passphrase" className={styles.label}>
                  Confirm Passphrase
                </label>
                <input
                  id="confirm-setup-passphrase"
                  type="password"
                  className={styles.input}
                  value={confirmSetupPassphrase}
                  onChange={(e) => setConfirmSetupPassphrase(e.target.value)}
                  placeholder="Re-enter passphrase…"
                  disabled={isSettingUp}
                  required
                />
              </div>

              <div className={styles.buttonRow}>
                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={isSettingUp || !setupPassphrase || !confirmSetupPassphrase}
                >
                  <Unlock size={14} aria-hidden="true" />
                  <span>{isSettingUp ? "Enabling Sync…" : "Enable Encrypted Sync"}</span>
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {/* Unlock Section (When sync is configured but device is locked) */}
        {syncState.status === "locked" ? (
          <section className={styles.section} aria-label="Unlock journal">
            <h3 className={styles.sectionTitle}>
              <Lock size={15} aria-hidden="true" />
              <span>Unlock Journal on this Device</span>
            </h3>
            <p className={styles.description}>
              An encrypted journal exists for your account. Enter your passphrase to unlock and
              synchronize your thoughts on this device.
            </p>

            <form onSubmit={handleUnlockSync} className={styles.formGroup}>
              {unlockError ? (
                <div className={styles.errorBox} role="alert">
                  <span>{unlockError}</span>
                </div>
              ) : null}

              <div className={styles.formGroup}>
                <label htmlFor="unlock-passphrase" className={styles.label}>
                  Master Passphrase
                </label>
                <input
                  id="unlock-passphrase"
                  type="password"
                  className={styles.input}
                  value={unlockPassphrase}
                  onChange={(e) => setUnlockPassphrase(e.target.value)}
                  placeholder="Enter your passphrase…"
                  disabled={isUnlocking}
                  required
                  autoFocus
                />
              </div>

              <div className={styles.buttonRow}>
                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={isUnlocking || !unlockPassphrase}
                >
                  <Unlock size={14} aria-hidden="true" />
                  <span>{isUnlocking ? "Unlocking…" : "Unlock Journal"}</span>
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {/* Conflicts Section */}
        {conflicts.length > 0 ? (
          <section className={styles.section} aria-label="Sync conflicts">
            <h3 className={styles.sectionTitle}>
              <AlertTriangle size={15} aria-hidden="true" />
              <span>Unresolved Conflicts ({conflicts.length})</span>
            </h3>
            <p className={styles.description}>
              Concurrent edits were made to the same post on different devices. Choose which version
              to retain.
            </p>

            {conflicts.map((conflict) => (
              <div key={conflict.id} className={styles.conflictCard}>
                <div className={styles.conflictVersions}>
                  <div className={styles.versionBox}>
                    <span className={styles.versionLabel}>This Device</span>
                    <p className={styles.versionBody}>{conflict.localPost.body}</p>
                  </div>
                  <div className={styles.versionBox}>
                    <span className={styles.versionLabel}>Other Device</span>
                    <p className={styles.versionBody}>{conflict.remotePost.body}</p>
                  </div>
                </div>
                <div className={styles.conflictActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => handleResolveConflict(conflict.id, "local")}
                  >
                    Keep This Device
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => handleResolveConflict(conflict.id, "remote")}
                  >
                    Keep Other Device
                  </button>
                </div>
              </div>
            ))}
          </section>
        ) : null}
    </ModalFrame>
  );
}
