"use client";

import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useFloating,
  type Placement,
} from "@floating-ui/react-dom";

export function useAnchoredFloating({
  open,
  placement,
  matchReferenceWidth = false,
}: {
  open: boolean;
  placement: Placement;
  matchReferenceWidth?: boolean;
}) {
  return useFloating({
    open,
    placement,
    strategy: "fixed",
    middleware: [
      offset(6),
      flip({ padding: 12 }),
      shift({ padding: 12 }),
      size({
        padding: 12,
        apply({ availableHeight, elements, rects }) {
          elements.floating.style.maxHeight = `${Math.max(120, availableHeight)}px`;
          if (matchReferenceWidth) {
            elements.floating.style.minWidth = `${rects.reference.width}px`;
          }
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });
}
