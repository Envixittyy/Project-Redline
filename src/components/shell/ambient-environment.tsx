"use client";

import { useEffect } from "react";
import { getTimeOfDay } from "@/lib/theme/time-of-day";
import styles from "./ambient-environment.module.css";

export function AmbientEnvironment() {
  useEffect(() => {
    // Keep data-time-of-day synchronized when tab remains open across day periods
    function syncTimeOfDay() {
      const current = getTimeOfDay();
      const root = document.documentElement;
      if (root.dataset.timeOfDay !== current) {
        root.dataset.timeOfDay = current;
      }
    }

    syncTimeOfDay();
    const interval = window.setInterval(syncTimeOfDay, 60_000);
    window.addEventListener("visibilitychange", syncTimeOfDay);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("visibilitychange", syncTimeOfDay);
    };
  }, []);

  return (
    <div className={styles.ambientContainer} aria-hidden="true">
      <div className={styles.ambientBase} />
      <div className={styles.ambientFieldPrimary} />
      <div className={styles.ambientFieldSecondary} />
      <div className={styles.ambientVignette} />
    </div>
  );
}
