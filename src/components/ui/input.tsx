import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

import styles from "./input.module.css";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
  prefixElement?: ReactNode;
  suffixElement?: ReactNode;
  label?: ReactNode;
  error?: ReactNode;
  helperText?: ReactNode;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className = "",
      invalid = false,
      prefixElement,
      suffixElement,
      label,
      error,
      helperText,
      disabled,
      id: customId,
      "aria-describedby": customDescribedBy,
      ...props
    },
    ref,
  ) => {
    const autoId = useId();
    const id = customId ?? `input-${autoId.replace(/:/g, "")}`;
    const errorId = error ? `${id}-error` : undefined;
    const helperId = !error && helperText ? `${id}-helper` : undefined;

    const describedBy =
      [customDescribedBy, errorId, helperId].filter(Boolean).join(" ") ||
      undefined;

    const isInvalid = Boolean(invalid || error);

    const inputElement = (
      <input
        ref={ref}
        id={id}
        disabled={disabled}
        aria-invalid={isInvalid ? "true" : undefined}
        aria-describedby={describedBy}
        className={`${styles.input} ${isInvalid ? styles.invalid : ""} ${
          prefixElement ? styles.hasPrefix : ""
        } ${suffixElement ? styles.hasSuffix : ""} ${className}`}
        {...props}
      />
    );

    const wrappedInput =
      !prefixElement && !suffixElement ? (
        inputElement
      ) : (
        <div className={styles.inputWrapper}>
          {prefixElement ? (
            <span className={styles.prefix} aria-hidden="true">
              {prefixElement}
            </span>
          ) : null}
          {inputElement}
          {suffixElement ? (
            <span className={styles.suffix}>{suffixElement}</span>
          ) : null}
        </div>
      );

    if (!label && !error && !helperText) {
      return wrappedInput;
    }

    return (
      <div className={styles.fieldGroup}>
        {label ? (
          <label htmlFor={id} className={styles.label}>
            {label}
          </label>
        ) : null}
        {wrappedInput}
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

Input.displayName = "Input";
