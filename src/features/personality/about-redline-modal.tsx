"use client";

import { ModalFrame } from "@/components/ui/modal-frame";
import { X } from "lucide-react";
import styles from "./about-redline-modal.module.css";

export function AboutRedlineModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalFrame
      label="About Adulting.exe"
      className={`${styles.panel} motion-enter`}
      onClose={onClose}
    >
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h2>ADULTING.EXE</h2>
          <div className={styles.subtitle}>Personal build</div>
        </div>
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close about dialog"
        >
          <X size={16} />
        </button>
      </div>

      <div className={styles.body}>
        <p>
          Built because apparently using six different apps for one life wasn’t
          annoying enough.
        </p>

        <div className={styles.manifesto}>
          One user.
          <br />
          One increasingly unreasonable codebase.
          <br />
          One very small planet.
        </div>

        <p style={{ fontSize: "0.85rem", color: "var(--text-tertiary)" }}>
          A private system for keeping track of one life on one very small world
          in a vast universe.
        </p>

        <div className={styles.footerMeta}>
          <span>Designed for: Kyle</span>
          <span>Designed by: also Kyle</span>
        </div>
      </div>
    </ModalFrame>
  );
}
