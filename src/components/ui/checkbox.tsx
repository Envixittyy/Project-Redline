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
      checked = false,
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

    const isChecked = Boolean(checked);

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
          checked={isChecked}
          disabled={disabled}
          readOnly={props.readOnly ?? (!onChange && checked !== undefined)}
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
          {indeterminate ? (
            <Minus size={13} strokeWidth={3} />
          ) : isChecked ? (
            <Check size={13} strokeWidth={3} />
          ) : null}
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
