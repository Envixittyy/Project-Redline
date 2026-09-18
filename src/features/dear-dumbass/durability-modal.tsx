"use client";

import { ModalFrame } from "@/components/ui/modal-frame";
import {
  checkStorageDurability,
  requestStoragePersistence,
  type StorageDurabilityState,
} from "@/services/private-store";
import {
  decryptBackupArchive,
  type DearDumbassRepository,
  type RestoreMode,
} from "@/services/dear-dumbass";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  HardDrive,
  Lock,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./durability-modal.module.css";

export type DurabilityModalProps = {
  repository: DearDumbassRepository;
  onClose: () => void;
};

export function DurabilityModal({ repository, onClose }: DurabilityModalProps) {
  // Durability state
  const [durability, setDurability] = useState<StorageDurabilityState>({
    isSupported: false,
    isPersisted: false,
    canRequest: false,
  });
  const [isRequestingPersist, setIsRequestingPersist] = useState(false);
  const [persistFeedback, setPersistFeedback] = useState<string | null>(null);

  // Export state
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [confirmExportPassphrase, setConfirmExportPassphrase] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  // Restore state
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [restoreMode, setRestoreMode] = useState<RestoreMode>("merge");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void checkStorageDurability().then((status) => {
      if (active) {
        setDurability(status);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const handleRequestPersistence = async () => {
    setIsRequestingPersist(true);
    setPersistFeedback(null);
    try {
      const res = await requestStoragePersistence();
      if (res.granted) {
        setDurability({
          isSupported: true,
          isPersisted: true,
          canRequest: false,
        });
        setPersistFeedback("Persistent storage granted by browser.");
      } else {
        setPersistFeedback(
          "Persistent storage request was not granted by your browser. Data remains saved locally under standard storage quotas.",
        );
      }
    } catch {
      setPersistFeedback(
        "Could not request persistent storage in this environment.",
      );
    } finally {
      setIsRequestingPersist(false);
    }
  };

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setExportError(null);
    setExportSuccess(null);

    const pass = exportPassphrase.trim();
    if (!pass) {
      setExportError("A passphrase is required to encrypt your backup.");
      return;
    }
    if (pass !== confirmExportPassphrase.trim()) {
      setExportError("Passphrases do not match. Please re-enter.");
      return;
    }

    setIsExporting(true);
    try {
      const envelope = await repository.exportArchive(pass);
      const jsonString = JSON.stringify(envelope, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const datePart = new Date().toISOString().split("T")[0];
      const filename = `dear-dumbass-backup-${datePart}.json`;

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      setExportPassphrase("");
      setConfirmExportPassphrase("");
      setExportSuccess(
        `Encrypted backup "${filename}" downloaded successfully.`,
      );
    } catch {
      setExportError(
        "Failed to generate encrypted backup. Your data remains safe locally.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    setRestoreError(null);
    setRestoreSuccess(null);

    if (!restoreFile) {
      setRestoreError("Please select a backup .json file to restore.");
      return;
    }

    const pass = restorePassphrase.trim();
    if (!pass) {
      setRestoreError("Enter the passphrase used when creating this backup.");
      return;
    }

    if (restoreMode === "replace" && !confirmReplace) {
      setRestoreError(
        "Please confirm that you want to replace your existing local archive.",
      );
      return;
    }

    setIsRestoring(true);
    try {
      const text = await restoreFile.text();
      let parsedEnvelope: unknown;
      try {
        parsedEnvelope = JSON.parse(text);
      } catch {
        throw new Error("Selected file is not valid JSON.");
      }

      // Decrypt and validate in memory before any DB writes
      const archive = await decryptBackupArchive(parsedEnvelope, pass);

      // Perform atomic database transaction
      const result = await repository.restoreArchive(archive, restoreMode);

      setRestorePassphrase("");
      setRestoreFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      if (result.mode === "replace") {
        setRestoreSuccess(
          `Archive replaced successfully. Restored ${result.restoredCount} records.`,
        );
      } else {
        setRestoreSuccess(
          `Archive merged: ${result.restoredCount} added, ${result.updatedCount} updated, ${result.preservedCount} preserved.`,
        );
      }
    } catch (err) {
      setRestoreError(
        err instanceof Error
          ? err.message
          : "Failed to restore backup. Zero database changes were made.",
      );
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <ModalFrame
      label="Storage & Encrypted Backup"
      className={`${styles.panel} motion-enter`}
      onClose={onClose}
    >
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h2 className={styles.title}>Storage &amp; Backup</h2>
          <p className={styles.subtitle}>
            Local persistence, Web Crypto export, and safe restore.
          </p>
        </div>
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={16} />
        </button>
      </header>

      {/* 1. Storage Durability Section */}
      <section className={styles.section} aria-label="Storage Durability">
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>
            <HardDrive size={16} aria-hidden="true" />
            <span>Local Durability</span>
          </h3>
          <span
            className={`${styles.statusBadge} ${
              durability.isPersisted
                ? styles.badgeSuccess
                : durability.canRequest
                  ? styles.badgeWarning
                  : styles.badgeMuted
            }`}
          >
            {durability.isPersisted
              ? "Persistent"
              : durability.canRequest
                ? "Best-Effort"
                : "Standard"}
          </span>
        </div>

        <p className={styles.description}>
          Dear Dumbass stores your journal strictly inside your browser&apos;s
          IndexedDB. Requesting persistent storage prevents the browser from
          automatically evicting local data when disk space is low.
        </p>

        {persistFeedback ? (
          <p className={styles.description} style={{ color: "var(--accent)" }}>
            {persistFeedback}
          </p>
        ) : null}

        {durability.canRequest ? (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={handleRequestPersistence}
            disabled={isRequestingPersist}
          >
            <Database size={14} aria-hidden="true" />
            <span>
              {isRequestingPersist
                ? "Requesting…"
                : "Request Persistent Storage"}
            </span>
          </button>
        ) : durability.isPersisted ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              fontSize: "0.75rem",
              color: "#10b981",
            }}
          >
            <CheckCircle2 size={14} />
            <span>Protected against automatic browser eviction</span>
          </div>
        ) : null}

        <p
          className={styles.description}
          style={{ fontSize: "0.75rem", fontStyle: "italic" }}
        >
          Note: Persistent storage reduces eviction risk, but clearing browser
          history or website data in browser settings can still delete local
          storage. Keep regular encrypted backups.
        </p>
      </section>

      {/* 2. Encrypted Backup Export */}
      <section className={styles.section} aria-label="Export Encrypted Backup">
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>
            <Download size={16} aria-hidden="true" />
            <span>Export Encrypted Backup</span>
          </h3>
          <span className={`${styles.statusBadge} ${styles.badgeMuted}`}>
            <Lock size={11} aria-hidden="true" />
            <span>AES-GCM 256</span>
          </span>
        </div>

        <p className={styles.description}>
          Export all active thoughts, replies, revisions, and deletion
          tombstones to an encrypted file on your device using standard Web
          Crypto.
        </p>

        <div className={styles.warningBox}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              fontWeight: 600,
            }}
          >
            <AlertTriangle size={13} />
            <span>Private Data Warning</span>
          </div>
          <span>
            An exported backup file is stored on your device. Anyone with the file
            and passphrase can read it. Never share your passphrase.
          </span>
        </div>

        {exportError ? (
          <div className={styles.errorBanner} role="alert">
            <span>{exportError}</span>
          </div>
        ) : null}

        {exportSuccess ? (
          <div className={styles.successBanner} role="status">
            <span>{exportSuccess}</span>
          </div>
        ) : null}

        <form onSubmit={handleExport} className={styles.formGroup}>
          <label className={styles.label} htmlFor="export-passphrase">
            Encryption Passphrase
          </label>
          <input
            id="export-passphrase"
            type="password"
            autoComplete="new-password"
            className={styles.input}
            placeholder="Choose a strong passphrase…"
            value={exportPassphrase}
            onChange={(e) => setExportPassphrase(e.target.value)}
            disabled={isExporting}
          />

          <label className={styles.label} htmlFor="export-confirm-passphrase">
            Confirm Passphrase
          </label>
          <input
            id="export-confirm-passphrase"
            type="password"
            autoComplete="new-password"
            className={styles.input}
            placeholder="Re-enter passphrase…"
            value={confirmExportPassphrase}
            onChange={(e) => setConfirmExportPassphrase(e.target.value)}
            disabled={isExporting}
          />

          <button
            type="submit"
            className={styles.primaryButton}
            disabled={
              isExporting ||
              !exportPassphrase.trim() ||
              exportPassphrase !== confirmExportPassphrase
            }
          >
            <Download size={14} aria-hidden="true" />
            <span>
              {isExporting ? "Encrypting…" : "Download Encrypted Backup"}
            </span>
          </button>
        </form>
      </section>

      {/* 3. Restore Backup */}
      <section className={styles.section} aria-label="Restore Backup">
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>
            <Upload size={16} aria-hidden="true" />
            <span>Restore Backup</span>
          </h3>
        </div>

        <p className={styles.description}>
          Decrypt and restore a previously exported Dear Dumbass backup file.
          Data is verified in memory before any database changes are made.
        </p>

        {restoreError ? (
          <div className={styles.errorBanner} role="alert">
            <span>{restoreError}</span>
          </div>
        ) : null}

        {restoreSuccess ? (
          <div className={styles.successBanner} role="status">
            <span>{restoreSuccess}</span>
          </div>
        ) : null}

        <form onSubmit={handleRestore} className={styles.formGroup}>
          <label className={styles.label} htmlFor="restore-file-input">
            Select Backup File (.json)
          </label>
          <input
            id="restore-file-input"
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className={styles.input}
            onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
            disabled={isRestoring}
          />

          <label className={styles.label} htmlFor="restore-passphrase">
            Passphrase
          </label>
          <input
            id="restore-passphrase"
            type="password"
            autoComplete="current-password"
            className={styles.input}
            placeholder="Enter the backup passphrase…"
            value={restorePassphrase}
            onChange={(e) => setRestorePassphrase(e.target.value)}
            disabled={isRestoring}
          />

          <div className={styles.radioGroup}>
            <label className={styles.radioOption}>
              <input
                type="radio"
                name="restore-mode"
                value="merge"
                checked={restoreMode === "merge"}
                onChange={() => setRestoreMode("merge")}
                disabled={isRestoring}
              />
              <span>
                <strong>Merge (Safe - Default):</strong> Adds new thoughts and
                newer edits. Preserves existing local data and deleted
                tombstones.
              </span>
            </label>

            <label className={styles.radioOption}>
              <input
                type="radio"
                name="restore-mode"
                value="replace"
                checked={restoreMode === "replace"}
                onChange={() => setRestoreMode("replace")}
                disabled={isRestoring}
              />
              <span>
                <strong>Replace Local Archive (Destructive):</strong> Replaces
                all local posts with the contents of this backup.
              </span>
            </label>
          </div>

          {restoreMode === "replace" ? (
            <label className={styles.checkboxOption}>
              <input
                type="checkbox"
                checked={confirmReplace}
                onChange={(e) => setConfirmReplace(e.target.checked)}
                disabled={isRestoring}
              />
              <span>I confirm I want to overwrite all local posts.</span>
            </label>
          ) : null}

          <button
            type="submit"
            className={styles.secondaryButton}
            disabled={
              isRestoring ||
              !restoreFile ||
              !restorePassphrase.trim() ||
              (restoreMode === "replace" && !confirmReplace)
            }
          >
            <Upload size={14} aria-hidden="true" />
            <span>{isRestoring ? "Restoring…" : "Restore Backup"}</span>
          </button>
        </form>
      </section>
    </ModalFrame>
  );
}
