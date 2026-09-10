"use client";

import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

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
  const autoId = useId();
  const panelId = customPanelId ?? `popover-${autoId.replace(/:/g, "")}`;

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

  const placementClass =
    placement === "bottom-end"
      ? styles.bottomEnd
      : placement === "top-start"
      ? styles.topStart
      : placement === "top-end"
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

  return (
    <PopoverContext.Provider value={{ role, onClose }}>
      <div ref={containerRef} className={`${styles.wrapper} ${className}`}>
        {renderedTrigger}
        {isOpen ? (
          <div
            id={panelId}
            role={role}
            aria-modal={role === "dialog" ? "false" : undefined}
            aria-label={ariaLabel}
            className={`${styles.panel} ${placementClass}`}
          >
            {children}
          </div>
        ) : null}
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
