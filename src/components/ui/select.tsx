"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import styles from "./select.module.css";

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type SelectProps = {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  className?: string;
};

export function Select({
  options,
  value,
  onChange,
  disabled = false,
  placeholder = "Select an option…",
  id: customId,
  ariaLabel,
  className,
}: SelectProps) {
  const generatedId = useId();
  const baseId = customId || generatedId;
  const listboxId = `${baseId}-listbox`;

  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);

  const selectedIndex = options.findIndex((opt) => opt.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;

  // Close dropdown if clicking outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isOpen]);

  // Keep focused option visible in scrollable listbox
  useEffect(() => {
    if (!isOpen || focusedIndex < 0 || !listboxRef.current) return;
    const optionEl = listboxRef.current.children[focusedIndex] as HTMLElement;
    if (optionEl) {
      optionEl.scrollIntoView({ block: "nearest" });
    }
  }, [isOpen, focusedIndex]);

  const openDropdown = useCallback(() => {
    if (disabled) return;
    setIsOpen(true);
    setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [disabled, selectedIndex]);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  const selectOption = useCallback(
    (index: number) => {
      const opt = options[index];
      if (!opt || opt.disabled) return;
      onChange(opt.value);
      closeDropdown();
    },
    [options, onChange, closeDropdown],
  );

  function handleTriggerClick() {
    if (isOpen) {
      closeDropdown();
    } else {
      openDropdown();
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;

    if (!isOpen) {
      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Enter" ||
        e.key === " "
      ) {
        e.preventDefault();
        openDropdown();
      }
      return;
    }

    switch (e.key) {
      case "Escape": {
        e.preventDefault();
        closeDropdown();
        break;
      }
      case "Tab": {
        setIsOpen(false);
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        if (focusedIndex >= 0) {
          selectOption(focusedIndex);
        }
        break;
      }
      case "ArrowDown": {
        e.preventDefault();
        let nextIndex = focusedIndex + 1;
        while (nextIndex < options.length && options[nextIndex].disabled) {
          nextIndex++;
        }
        if (nextIndex < options.length) {
          setFocusedIndex(nextIndex);
        }
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        let prevIndex = focusedIndex - 1;
        while (prevIndex >= 0 && options[prevIndex].disabled) {
          prevIndex--;
        }
        if (prevIndex >= 0) {
          setFocusedIndex(prevIndex);
        }
        break;
      }
      case "Home": {
        e.preventDefault();
        const first = options.findIndex((o) => !o.disabled);
        if (first >= 0) setFocusedIndex(first);
        break;
      }
      case "End": {
        e.preventDefault();
        for (let i = options.length - 1; i >= 0; i--) {
          if (!options[i].disabled) {
            setFocusedIndex(i);
            break;
          }
        }
        break;
      }
      default: {
        // Quick type-ahead search
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const char = e.key.toLowerCase();
          const matchIndex = options.findIndex(
            (o, i) =>
              !o.disabled &&
              i > focusedIndex &&
              o.label.toLowerCase().startsWith(char),
          );
          if (matchIndex >= 0) {
            setFocusedIndex(matchIndex);
          } else {
            const wrapIndex = options.findIndex(
              (o) => !o.disabled && o.label.toLowerCase().startsWith(char),
            );
            if (wrapIndex >= 0) setFocusedIndex(wrapIndex);
          }
        }
      }
    }
  }

  const focusedOptionId =
    focusedIndex >= 0 ? `${baseId}-opt-${focusedIndex}` : undefined;

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${className || ""}`}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        id={baseId}
        className={styles.trigger}
        onClick={handleTriggerClick}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={ariaLabel}
      >
        <span
          className={`${styles.triggerValue} ${
            !selectedOption ? styles.placeholder : ""
          }`}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          size={16}
          className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ""}`}
          aria-hidden="true"
        />
      </button>

      {isOpen ? (
        <ul
          ref={listboxRef}
          id={listboxId}
          className={`${styles.listbox} motion-dropdown-enter`}
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={focusedOptionId}
          aria-label={ariaLabel || "Options"}
        >
          {options.map((opt, index) => {
            const isSelected = opt.value === value;
            const isFocused = index === focusedIndex;
            const optId = `${baseId}-opt-${index}`;

            return (
              <li
                key={opt.value}
                id={optId}
                role="option"
                aria-selected={isSelected}
                aria-disabled={opt.disabled}
                className={`${styles.option} ${
                  isFocused ? styles.optionFocused : ""
                } ${isSelected ? styles.optionSelected : ""} ${
                  opt.disabled ? styles.optionDisabled : ""
                }`}
                onMouseEnter={() => {
                  if (!opt.disabled) setFocusedIndex(index);
                }}
                onClick={() => {
                  if (!opt.disabled) selectOption(index);
                }}
              >
                <div className={styles.optionText}>
                  <span className={styles.optionLabel}>{opt.label}</span>
                  {opt.description ? (
                    <span className={styles.optionDescription}>
                      {opt.description}
                    </span>
                  ) : null}
                </div>
                {isSelected ? (
                  <Check
                    size={15}
                    className={styles.checkIcon}
                    aria-hidden="true"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

