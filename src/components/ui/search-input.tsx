"use client";

import { Search, X } from "lucide-react";
import {
  forwardRef,
  useRef,
  type InputHTMLAttributes,
} from "react";

import styles from "./input.module.css";

export type SearchInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  onClear?: () => void;
  shortcut?: string;
};

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      className = "",
      value,
      onChange,
      onClear,
      shortcut,
      placeholder = "Search…",
      ...props
    },
    ref,
  ) => {
    const internalInputRef = useRef<HTMLInputElement | null>(null);
    const hasValue = Boolean(value && String(value).length > 0);

    const handleClear = () => {
      onClear?.();
      if (internalInputRef.current) {
        internalInputRef.current.value = "";
        const event = new Event("input", { bubbles: true });
        internalInputRef.current.dispatchEvent(event);
        internalInputRef.current.focus();
      }
    };

    return (
      <div className={styles.inputWrapper}>
        <span className={styles.prefix} aria-hidden="true">
          <Search size={16} />
        </span>
        <input
          ref={(node) => {
            internalInputRef.current = node;
            if (typeof ref === "function") {
              ref(node);
            } else if (ref) {
              ref.current = node;
            }
          }}
          type="search"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className={`${styles.input} ${styles.hasPrefix} ${
            hasValue || shortcut ? styles.hasSuffix : ""
          } ${className}`}
          {...props}
        />
        <div className={styles.suffix}>
          {hasValue && onClear ? (
            <button
              type="button"
              className={styles.clearButton}
              onClick={handleClear}
              aria-label="Clear search"
            >
              <X size={13} aria-hidden="true" />
            </button>
          ) : shortcut ? (
            <kbd className={styles.searchKbd}>{shortcut}</kbd>
          ) : null}
        </div>
      </div>
    );
  },
);

SearchInput.displayName = "SearchInput";
