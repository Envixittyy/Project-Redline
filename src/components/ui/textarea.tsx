import { forwardRef, type TextareaHTMLAttributes } from "react";

import styles from "./input.module.css";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = "", invalid = false, disabled, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        disabled={disabled}
        aria-invalid={invalid ? "true" : undefined}
        className={`${styles.textarea} ${className}`}
        {...props}
      />
    );
  },
);

Textarea.displayName = "Textarea";
