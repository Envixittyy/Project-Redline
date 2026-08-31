"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./modal-frame.module.css";

/** Native modal supplies focus containment, Escape, and return-focus semantics. */
export function ModalFrame({
  children,
  label,
  className,
  onClose,
}: {
  children: ReactNode;
  label: string;
  className?: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={`${styles.dialog} ${className ?? ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (event.key === "Tab") {
          const elements = Array.from(
            ref.current?.querySelectorAll<HTMLElement>(
              "button:enabled, input:enabled, select:enabled, textarea:enabled, [tabindex]:not([tabindex='-1'])",
            ) ?? [],
          ).filter((element) => element.getClientRects().length > 0);
          const first = elements.at(0);
          const last = elements.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}
