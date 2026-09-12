"use client";

import { useEffect, useState } from "react";

/**
 * Hook to manage floating surface presence with smooth exit animations.
 *
 * Keeps the floating surface mounted during its exit transition (110ms by default,
 * using Forward's `--motion-fast` token) so the closing animation can complete before
 * removing the element from the DOM.
 */
export function useFloatingPresence(
  isOpen: boolean,
  exitDurationMs = 110,
): { isMounted: boolean; isExiting: boolean } {
  const [mounted, setMounted] = useState(isOpen);
  const [isExiting, setIsExiting] = useState(false);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setMounted(true);
      setIsExiting(false);
    } else if (mounted) {
      setIsExiting(true);
    }
  }

  useEffect(() => {
    if (!isOpen && isExiting) {
      const timer = setTimeout(() => {
        setMounted(false);
        setIsExiting(false);
      }, exitDurationMs);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isExiting, exitDurationMs]);

  return { isMounted: mounted, isExiting };
}
