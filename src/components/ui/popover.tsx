"use client";

import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { useFloatingPresence } from "./use-floating-presence";
import { useAnchoredFloating } from "./use-anchored-floating";
import { useFloatingPortalRoot } from "./floating-portal-root";
import styles from "./popover.module.css";

export type PopoverPlacement =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end";

export type PopoverRole = "dialog" | "menu" | "region";

type PopoverContextValue = {
  role: PopoverRole;
  onClose: () => void;
};

const PopoverContext = createContext<PopoverContextValue | null>(null);

export type PopoverProps = {
  isOpen: boolean;
  onClose: () => void;
  trigger: ReactNode;
  children: ReactNode;
  placement?: PopoverPlacement;
  className?: string;
  ariaLabel?: string;
  role?: PopoverRole;
  panelId?: string;
};

export function Popover({
  isOpen,
  onClose,
  trigger,
  children,
  placement = "bottom-start",
  className = "",
  ariaLabel,
  role = "dialog",
  panelId: customPanelId,
}: PopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const autoId = useId();
  const panelId = customPanelId ?? `popover-${autoId.replace(/:/g, "")}`;

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(e: MouseEvent | TouchEvent) {
      if (
        !containerRef.current?.contains(e.target as Node) &&
        !panelRef.current?.contains(e.target as Node)
      ) {
        onClose();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        const triggerEl = containerRef.current?.querySelector<HTMLElement>(
          'button, [href], input, [tabindex]:not([tabindex="-1"])',
        );
        triggerEl?.focus();
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

  const { isMounted, isExiting } = useFloatingPresence(isOpen, 110);
  const portalRoot = useFloatingPortalRoot(anchorEl, isMounted);
  const { refs, floatingStyles, placement: resolvedPlacement } = useAnchoredFloating({
    open: isMounted,
    placement,
  });

  const placementClass =
    resolvedPlacement === "bottom-end"
      ? styles.bottomEnd
      : resolvedPlacement === "top-start"
      ? styles.topStart
      : resolvedPlacement === "top-end"
      ? styles.topEnd
      : styles.bottomStart;

  let renderedTrigger = trigger;
  if (trigger && typeof trigger === "object" && "type" in trigger) {
    const triggerElement = trigger as ReactElement<{
      "aria-haspopup"?: boolean | "menu" | "dialog" | "listbox" | "tree" | "grid";
      "aria-expanded"?: boolean;
      "aria-controls"?: string;
    }>;
    renderedTrigger = cloneElement(triggerElement, {
      "aria-haspopup": role === "menu" ? "menu" : "dialog",
      "aria-expanded": isOpen,
      "aria-controls": isOpen ? panelId : undefined,
    });
  }

  const panel = isMounted ? (
    <div
      ref={(node) => {
        panelRef.current = node;
        refs.setFloating(node);
      }}
      style={floatingStyles}
      id={panelId}
      role={role}
      aria-modal={role === "dialog" ? "false" : undefined}
      aria-label={ariaLabel}
      className={`${styles.panel} ${placementClass} ${
        isExiting ? styles.exiting : ""
      }`}
    >
      {children}
    </div>
  ) : null;

  return (
    <PopoverContext.Provider value={{ role, onClose }}>
      <div
        ref={(node) => {
          containerRef.current = node;
          refs.setReference(node);
          setAnchorEl(node);
        }}
        className={`${styles.wrapper} ${className}`}
      >
        {renderedTrigger}
        {panel && typeof document !== "undefined"
          ? createPortal(panel, portalRoot ?? document.body)
          : panel}
      </div>
    </PopoverContext.Provider>
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
  role,
  onClick,
  ...props
}: PopoverItemProps) {
  const context = useContext(PopoverContext);
  const resolvedRole =
    role ?? (context?.role === "menu" ? "menuitem" : undefined);

  return (
    <button
      type={type}
      role={resolvedRole}
      className={`${styles.item} ${
        destructive ? styles.itemDestructive : ""
      } ${className}`}
      onClick={(e) => {
        onClick?.(e);
      }}
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
