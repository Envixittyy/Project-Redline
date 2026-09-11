import { Loader2 } from "lucide-react";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconPosition?: "left" | "right";
  iconOnly?: boolean;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className = "",
      variant = "secondary",
      size = "md",
      icon,
      iconPosition = "left",
      iconOnly = false,
      loading = false,
      disabled = false,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;
    const isIconOnly = iconOnly || (!children && Boolean(icon));

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading ? "true" : undefined}
        className={`${styles.button} ${styles[variant]} ${styles[size]} ${
          isIconOnly ? styles.iconOnly : ""
        } ${className}`}
        {...props}
      >
        {loading ? (
          <Loader2
            className={styles.spinner}
            size={size === "sm" ? 14 : size === "lg" ? 18 : 16}
            aria-hidden="true"
          />
        ) : icon && iconPosition === "left" ? (
          <span aria-hidden="true" style={{ display: "inline-flex" }}>
            {icon}
          </span>
        ) : null}

        {isIconOnly ? null : children}

        {!loading && icon && iconPosition === "right" && !isIconOnly ? (
          <span aria-hidden="true" style={{ display: "inline-flex" }}>
            {icon}
          </span>
        ) : null}
      </button>
    );
  },
);

Button.displayName = "Button";

export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "iconOnly"> & { "aria-label": string }
>((props, ref) => <Button ref={ref} iconOnly {...props} />);

IconButton.displayName = "IconButton";
