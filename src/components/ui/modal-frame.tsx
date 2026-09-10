"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./modal-frame.module.css";

export type ModalSize = "sm" | "md" | "lg" | "full";

export type ModalFrameProps = {
  children: ReactNode;
  label: string;
  size?: ModalSize;
  className?: string;
  onClose: () => void;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
};

/** Native modal supplies focus containment, Escape, and return-focus semantics. */
export function ModalFrame({
  children,
  label,
  size = "md",
  className = "",
  onClose,
  initialFocusRef,
}: ModalFrameProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousActiveElement.current = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();

      // Enter focus appropriately
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          if (!dialog.isConnected) return;
          if (initialFocusRef?.current) {
            initialFocusRef.current.focus();
          } else {
            const autoFocusElement =
              dialog.querySelector<HTMLElement>("[autofocus]");
            if (autoFocusElement) {
              autoFocusElement.focus();
            } else {
              const firstFocusable = dialog.querySelector<HTMLElement>(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
              );
              if (firstFocusable) {
                firstFocusable.focus();
              } else {
                dialog.focus();
              }
            }
          }
        });
      }
    }

    return () => {
      if (dialog && dialog.open) {
        dialog.close();
      }
      if (
        previousActiveElement.current &&
        typeof previousActiveElement.current.focus === "function"
      ) {
        previousActiveElement.current.focus();
      }
    };
  }, [initialFocusRef]);

  const sizeClass =
    size === "sm"
      ? styles.sizeSm
      : size === "lg"
      ? styles.sizeLg
      : size === "full"
      ? styles.sizeFull
      : styles.sizeMd;

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className={`${styles.dialog} ${sizeClass} ${className}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (event.key === "Tab") {
          const focusable = Array.from(
            ref.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ) ?? [],
          ).filter(
            (element) =>
              element.offsetParent !== null ||
              element.getClientRects().length > 0 ||
              (typeof window !== "undefined" &&
                window.getComputedStyle(element).display !== "none"),
          );

          if (focusable.length === 0) {
            event.preventDefault();
            return;
          }

          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (event.shiftKey) {
            if (
              document.activeElement === first ||
              !ref.current?.contains(document.activeElement)
            ) {
              event.preventDefault();
              last.focus();
            }
          } else {
            if (
              document.activeElement === last ||
              !ref.current?.contains(document.activeElement)
            ) {
              event.preventDefault();
              first.focus();
            }
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

export function ModalHeader({
  children,
  onClose,
  className = "",
}: {
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <header className={`${styles.header} ${className}`}>
      <div className={styles.titleGroup}>{children}</div>
      {onClose ? <ModalCloseButton onClose={onClose} /> : null}
    </header>
  );
}

export function ModalTitle({
  children,
  id,
  className = "",
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <h2 id={id} className={`${styles.title} ${className}`}>
      {children}
    </h2>
  );
}

export function ModalDescription({
  children,
  id,
  className = "",
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <p id={id} className={`${styles.description} ${className}`}>
      {children}
    </p>
  );
}

export function ModalBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`${styles.body} ${className}`}>{children}</div>;
}

export function ModalFooter({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <footer className={`${styles.footer} ${className}`}>{children}</footer>;
}

export function ModalCloseButton({
  onClose,
  label = "Close dialog",
}: {
  onClose: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={styles.closeButton}
      onClick={onClose}
      aria-label={label}
    >
      <X size={18} aria-hidden="true" />
    </button>
  );
}

export type ModalProps = {
  isOpen?: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  className?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
};

export function Modal({
  isOpen = true,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  className = "",
  initialFocusRef,
}: ModalProps) {
  if (!isOpen) return null;

  return (
    <ModalFrame
      label={typeof title === "string" ? title : "Dialog"}
      size={size}
      className={className}
      onClose={onClose}
      initialFocusRef={initialFocusRef}
    >
      <ModalHeader onClose={onClose}>
        <ModalTitle>{title}</ModalTitle>
        {description ? <ModalDescription>{description}</ModalDescription> : null}
      </ModalHeader>
      <ModalBody>{children}</ModalBody>
      {footer ? <ModalFooter>{footer}</ModalFooter> : null}
    </ModalFrame>
  );
}
