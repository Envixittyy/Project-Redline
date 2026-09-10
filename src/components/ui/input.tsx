import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

import styles from "./input.module.css";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
  prefixElement?: ReactNode;
  suffixElement?: ReactNode;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className = "",
      invalid = false,
      prefixElement,
      suffixElement,
      disabled,
      ...props
    },
    ref,
  ) => {
    const inputElement = (
      <input
        ref={ref}
        disabled={disabled}
        aria-invalid={invalid ? "true" : undefined}
        className={`${styles.input} ${invalid ? styles.invalid : ""} ${
          prefixElement ? styles.hasPrefix : ""
        } ${suffixElement ? styles.hasSuffix : ""} ${className}`}
        {...props}
      />
    );

    if (!prefixElement && !suffixElement) {
      return inputElement;
    }

    return (
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
  },
);

Input.displayName = "Input";
