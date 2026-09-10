"use client";

import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import styles from "./popover.module.css";

export type PopoverPlacement =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end";

export type PopoverProps = {
  isOpen: boolean;
  onClose: () => void;
  trigger: ReactNode;
  children: ReactNode;
  placement?: PopoverPlacement;
  className?: string;
  ariaLabel?: string;
};

export function Popover({
  isOpen,
  onClose,
  trigger,
  children,
  placement = "bottom-start",
  className = "",
  ariaLabel,
}: PopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(e: MouseEvent | TouchEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const placementClass =
    placement === "bottom-end"
      ? styles.bottomEnd
      : placement === "top-start"
      ? styles.topStart
      : placement === "top-end"
      ? styles.topEnd
      : styles.bottomStart;

  return (
    <div ref={containerRef} className={`${styles.wrapper} ${className}`}>
      {trigger}
      {isOpen ? (
        <div
          role="menu"
          aria-label={ariaLabel}
          className={`${styles.panel} ${placementClass}`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export type PopoverItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  destructive?: boolean;
};

export function PopoverItem({
  children,
  icon,
  destructive = false,
  className = "",
  type = "button",
  ...props
}: PopoverItemProps) {
  return (
    <button
      type={type}
      role="menuitem"
      className={`${styles.item} ${
        destructive ? styles.itemDestructive : ""
      } ${className}`}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" style={{ display: "inline-flex" }}>
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
    </button>
  );
}

export function PopoverSeparator({
  className = "",
  ...props
}: HTMLAttributes<HTMLHRElement>) {
  return <hr className={`${styles.separator} ${className}`} {...props} />;
}
