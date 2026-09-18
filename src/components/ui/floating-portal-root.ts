"use client";

import { useSyncExternalStore } from "react";

/**
 * Resolves the portal root element for floating menus and popovers.
 * If the reference element is contained within an open HTML `<dialog>`,
 * the portal is directed into that dialog so it participates in the browser's
 * top-layer stacking context. Otherwise, it falls back to `document.body`.
 */
export function getFloatingPortalRoot(
  element: HTMLElement | null,
): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  if (!element) {
    return document.body;
  }
  const dialog = element.closest("dialog");
  if (dialog && (dialog.open || dialog.hasAttribute("open"))) {
    return dialog;
  }
  return document.body;
}

const emptySubscribe = () => () => {};

/**
 * Hook to resolve the appropriate portal root for a floating reference element.
 */
export function useFloatingPortalRoot(
  element: HTMLElement | null,
  active: boolean = true,
): HTMLElement | null {
  return useSyncExternalStore(
    emptySubscribe,
    () => (active ? getFloatingPortalRoot(element) : null),
    () => null,
  );
}
