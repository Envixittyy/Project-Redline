"use client";

import { useServerInsertedHTML } from "next/navigation";
import { useRef } from "react";

import { appearanceInitScript } from "@/lib/theme/appearance";

/**
 * Insert the appearance bootstrap into the server-rendered document head.
 * The hook has no client-side effect, so React never creates or hydrates the
 * executable script in its client tree.
 */
export function AppearanceInitScript() {
  const inserted = useRef(false);

  useServerInsertedHTML(() => {
    if (inserted.current) {
      return null;
    }

    inserted.current = true;
    return (
      <script
        id="appearance-init"
        dangerouslySetInnerHTML={{ __html: appearanceInitScript }}
      />
    );
  });

  return null;
}
