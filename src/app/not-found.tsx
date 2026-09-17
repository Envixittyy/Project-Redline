import Link from "next/link";
import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Surface } from "@/components/ui/surface";
import { copy } from "@/lib/copy";

export default function NotFound() {
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
          icon={<Compass size={36} aria-hidden="true" />}
          title={copy.errors.notFoundTitle}
          description={copy.errors.notFoundMessage}
          action={
            <Link href="/" style={{ textDecoration: "none" }}>
              <Button variant="primary" size="md">
                Back to So, Ano Na?
              </Button>
            </Link>
          }
        />
      </Surface>
    </div>
  );
}
