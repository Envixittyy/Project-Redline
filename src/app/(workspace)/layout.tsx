import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { requireWorkspaceAccess } from "@/features/auth/auth-session";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  await requireWorkspaceAccess();

  return <AppShell>{children}</AppShell>;
}

