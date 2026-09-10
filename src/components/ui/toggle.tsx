import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

import styles from "./toggle.module.css";

export type ToggleProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: ReactNode;
  description?: ReactNode;
};

export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(
  (
    {
      className = "",
      checked = false,
      disabled = false,
      label,
      description,
      onChange,
      id,
      ...props
    },
    ref,
  ) => {
    return (
      <label
        className={`${styles.container} ${
          disabled ? styles.containerDisabled : ""
        } ${className}`}
        htmlFor={id}
      >
        {label || description ? (
          <div className={styles.textGroup}>
            {label ? <span className={styles.label}>{label}</span> : null}
            {description ? (
              <span className={styles.description}>{description}</span>
            ) : null}
          </div>
        ) : null}

        <span className={styles.switch}>
          <input
            ref={ref}
            id={id}
            type="checkbox"
            role="switch"
            checked={checked}
            disabled={disabled}
            readOnly={props.readOnly ?? (!onChange && checked !== undefined)}
            onChange={onChange}
            className={styles.input}
            aria-checked={checked}
            {...props}
          />
          <span className={styles.track} aria-hidden="true">
            <span className={styles.thumb} />
          </span>
        </span>
      </label>
    );
  },
);

Toggle.displayName = "Toggle";
