import {
  forwardRef,
  useId,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

import styles from "./input.module.css";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
  label?: ReactNode;
  error?: ReactNode;
  helperText?: ReactNode;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className = "",
      invalid = false,
      disabled,
      label,
      error,
      helperText,
      id: customId,
      "aria-describedby": customDescribedBy,
      ...props
    },
    ref,
  ) => {
    const autoId = useId();
    const id = customId ?? `textarea-${autoId.replace(/:/g, "")}`;
    const errorId = error ? `${id}-error` : undefined;
    const helperId = !error && helperText ? `${id}-helper` : undefined;

    const describedBy =
      [customDescribedBy, errorId, helperId].filter(Boolean).join(" ") ||
      undefined;

    const isInvalid = Boolean(invalid || error);

    const textareaElement = (
      <textarea
        ref={ref}
        id={id}
        disabled={disabled}
        aria-invalid={isInvalid ? "true" : undefined}
        aria-describedby={describedBy}
        className={`${styles.textarea} ${isInvalid ? styles.invalid : ""} ${className}`}
        {...props}
      />
    );

    if (!label && !error && !helperText) {
      return textareaElement;
    }

    return (
      <div className={styles.fieldGroup}>
        {label ? (
          <label htmlFor={id} className={styles.label}>
            {label}
          </label>
        ) : null}
        {textareaElement}
        {error ? (
          <p id={errorId} role="alert" className={styles.errorText}>
            {error}
          </p>
        ) : helperText ? (
          <p id={helperId} className={styles.helperText}>
            {helperText}
          </p>
        ) : null}
      </div>
    );
  },
);

Textarea.displayName = "Textarea";
