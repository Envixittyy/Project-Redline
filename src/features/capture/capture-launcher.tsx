"use client";

import { Inbox, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { CaptureComposer } from "./capture-composer";
import styles from "./capture.module.css";

const openCaptureEvent = "forward:open-capture";

export function CaptureTrigger({ compact = false }: { compact?: boolean }) {
  return (
    <button
      type="button"
      className={compact ? styles.compactTrigger : styles.captureTrigger}
      aria-label={compact ? "Open universal capture" : undefined}
      onClick={() => window.dispatchEvent(new Event(openCaptureEvent))}
    >
      <Plus size={compact ? 19 : 17} aria-hidden="true" />
      {compact ? null : <span>Capture</span>}
      {compact ? null : <kbd>Ctrl ⇧ Space</kbd>}
    </button>
  );
}

export function CaptureLauncher() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function show() {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    }
    function keyboard(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "Space") {
        event.preventDefault();
        show();
      }
    }
    window.addEventListener(openCaptureEvent, show);
    window.addEventListener("keydown", keyboard);
    return () => {
      window.removeEventListener(openCaptureEvent, show);
      window.removeEventListener("keydown", keyboard);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => panelRef.current?.querySelector("textarea")?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function close() {
    setOpen(false);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }

  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>("a,button:not([disabled]),textarea:not([disabled])"));
    const first = focusable.at(0);
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  if (!open) return null;

  return (
    <div className={styles.launcherBackdrop} onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div ref={panelRef} className={styles.launcherPanel} role="dialog" aria-modal="true" aria-labelledby="capture-dialog-title" onKeyDown={trapFocus}>
        <div className={styles.launcherHeading}>
          <span className={styles.launcherIcon} aria-hidden="true"><Inbox size={18} /></span>
          <div>
            <p>Universal capture</p>
            <h2 id="capture-dialog-title">Get it out of your head</h2>
          </div>
          <button type="button" aria-label="Close universal capture" onClick={close}><X size={18} aria-hidden="true" /></button>
        </div>
        <CaptureComposer compact onCaptured={close} />
        <Link className={styles.inboxLink} href="/inbox" onClick={close}>Open Capture Inbox</Link>
      </div>
    </div>
  );
}
