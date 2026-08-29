"use client";

import { Check, SlidersHorizontal } from "lucide-react";
import {
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { Surface } from "@/components/ui/surface";

import styles from "./dashboard-customizer.module.css";

const widgetOptions = [
  { id: "today", label: "Today" },
  { id: "overdue", label: "Overdue" },
  { id: "upcoming", label: "Upcoming" },
  { id: "school", label: "School" },
  { id: "notes", label: "Quick note" },
] as const;

type WidgetId = (typeof widgetOptions)[number]["id"];
type WidgetVisibility = Record<WidgetId, boolean>;

const defaultVisibility: WidgetVisibility = {
  today: true,
  overdue: true,
  upcoming: true,
  school: true,
  notes: true,
};

const storageKey = "life-os.dashboard.v1.visibility";
const visibilityEvent = "life-os:dashboard-visibility";
let cachedVisibility = defaultVisibility;

function readVisibility(): WidgetVisibility {
  if (typeof window === "undefined") return defaultVisibility;

  try {
    const stored = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "{}",
    ) as Partial<Record<WidgetId, unknown>>;
    const next = Object.fromEntries(
      widgetOptions.map(({ id }) => [
        id,
        typeof stored[id] === "boolean" ? stored[id] : true,
      ]),
    ) as WidgetVisibility;

    if (widgetOptions.some(({ id }) => cachedVisibility[id] !== next[id])) {
      cachedVisibility = next;
    }

    return cachedVisibility;
  } catch {
    return defaultVisibility;
  }
}

function subscribe(onStoreChange: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key === storageKey) onStoreChange();
  }

  window.addEventListener(visibilityEvent, onStoreChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(visibilityEvent, onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

function saveVisibility(next: WidgetVisibility) {
  cachedVisibility = next;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Keep the visible preference for this document when storage is unavailable.
  }
  window.dispatchEvent(new Event(visibilityEvent));
}

export function DashboardCustomizer({ children }: { children: ReactNode }) {
  const visibility = useSyncExternalStore(
    subscribe,
    readVisibility,
    () => defaultVisibility,
  );
  const [editing, setEditing] = useState(false);

  function toggle(id: WidgetId) {
    saveVisibility({ ...visibility, [id]: !visibility[id] });
  }

  return (
    <section aria-labelledby="dashboard-heading">
      <div className={styles.toolbar}>
        <div>
          <p className={styles.kicker}>Today at a glance</p>
          <h2 id="dashboard-heading">What matters now</h2>
        </div>
        <button
          type="button"
          className={`${styles.editButton} motion-interactive`}
          aria-expanded={editing}
          aria-controls="dashboard-widget-controls"
          onClick={() => setEditing((current) => !current)}
        >
          <SlidersHorizontal size={17} aria-hidden="true" />
          <span>{editing ? "Done" : "Customize"}</span>
        </button>
      </div>

      {editing ? (
        <Surface
          id="dashboard-widget-controls"
          variant="subtle"
          className={`${styles.controls} motion-enter`}
        >
          <div>
            <h3>Visible sections</h3>
            <p>Keep Home quiet. Hidden sections remain available elsewhere.</p>
          </div>
          <div className={styles.toggleList}>
            {widgetOptions.map((option) => {
              const visible = visibility[option.id];
              return (
                <button
                  type="button"
                  key={option.id}
                  className={`${styles.toggleButton} motion-interactive`}
                  data-visible={visible || undefined}
                  aria-pressed={visible}
                  onClick={() => toggle(option.id)}
                >
                  <span className={styles.check} aria-hidden="true">
                    {visible ? <Check size={14} /> : null}
                  </span>
                  {option.label}
                </button>
              );
            })}
          </div>
        </Surface>
      ) : null}

      <div
        className={styles.grid}
        data-hide-today={!visibility.today || undefined}
        data-hide-overdue={!visibility.overdue || undefined}
        data-hide-upcoming={!visibility.upcoming || undefined}
        data-hide-school={!visibility.school || undefined}
        data-hide-notes={!visibility.notes || undefined}
      >
        {children}
      </div>
    </section>
  );
}
