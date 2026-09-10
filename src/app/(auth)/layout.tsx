import type { ReactNode } from "react";

import { AmbientEnvironment } from "@/components/shell/ambient-environment";
import { AmbientProvider } from "@/components/shell/ambient-context";
import styles from "./auth-layout.module.css";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <AmbientProvider>
      <main className={styles.shell}>
        <AmbientEnvironment />
        <div className={styles.frame}>{children}</div>
      </main>
    </AmbientProvider>
  );
}
