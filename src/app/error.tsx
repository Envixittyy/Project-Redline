"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Surface } from "@/components/ui/surface";
import { copy } from "@/lib/copy";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log unexpected client error to console
    console.error(error);
  }, [error]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "1.5rem",
      }}
    >
      <Surface variant="glass" style={{ maxWidth: "32rem", width: "100%", padding: "2rem" }}>
        <EmptyState
          icon={<AlertTriangle size={36} aria-hidden="true" />}
          title={copy.errors.genericTitle}
          description={copy.errors.genericMessage}
          action={
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
              <Button variant="primary" size="md" onClick={() => reset()}>
                <RefreshCw size={14} aria-hidden="true" />
                <span>Try again</span>
              </Button>
              <Link href="/" style={{ textDecoration: "none" }}>
                <Button variant="secondary" size="md">
                  <span>Go home</span>
                </Button>
              </Link>
            </div>
          }
        />
      </Surface>
    </div>
  );
}
