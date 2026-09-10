import { Check, Minus } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

import styles from "./checkbox.module.css";

export type CheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  indeterminate?: boolean;
  label?: ReactNode;
  description?: ReactNode;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      className = "",
      checked,
      indeterminate = false,
      disabled = false,
      label,
      description,
      onChange,
      ...props
    },
    ref,
  ) => {
    const internalRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
      if (internalRef.current) {
        internalRef.current.indeterminate = indeterminate;
      }
    }, [indeterminate]);

    const isChecked = checked !== undefined ? Boolean(checked) : undefined;

    return (
      <label
        className={`${styles.container} ${
          disabled ? styles.containerDisabled : ""
        } ${className}`}
      >
        <input
          ref={(node) => {
            internalRef.current = node;
            if (typeof ref === "function") {
              ref(node);
            } else if (ref) {
              ref.current = node;
            }
          }}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          className={styles.input}
          {...props}
        />
        <span
          className={`${styles.box} ${
            isChecked ? styles.boxChecked : ""
          } ${indeterminate ? styles.boxIndeterminate : ""}`}
          aria-hidden="true"
        >
          <Minus size={13} strokeWidth={3} className={styles.minusIcon} />
          <Check size={13} strokeWidth={3} className={styles.checkIcon} />
        </span>
        {label || description ? (
          <div>
            {label ? <span className={styles.label}>{label}</span> : null}
            {description ? (
              <span className={styles.description}>{description}</span>
            ) : null}
          </div>
        ) : null}
      </label>
    );
  },
);

Checkbox.displayName = "Checkbox";
