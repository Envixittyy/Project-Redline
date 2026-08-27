"use client";

import { BookOpen, CalendarClock, Eye, EyeOff, FolderKanban, SlidersHorizontal, Sun } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { Surface } from "@/components/ui/surface";

import styles from "./widget-preview.module.css";

const widgets = [
  { id: "today", title: "Today", description: "Your daily focus will settle here.", icon: Sun },
  { id: "upcoming", title: "Upcoming", description: "A calm look at what is approaching.", icon: CalendarClock },
  { id: "projects", title: "Current Projects", description: "Active work will stay within reach.", icon: FolderKanban },
  { id: "school", title: "School", description: "Course priorities will surface here.", icon: BookOpen },
] as const;

type WidgetId = (typeof widgets)[number]["id"];
type WidgetVisibility = Record<WidgetId, boolean>;

const defaultVisibility: WidgetVisibility = {
  today: true,
  upcoming: true,
  projects: true,
  school: true,
};

const storageKey = "life-os.widgets.v1.visibility";
const visibilityEvent = "life-os:widget-visibility";
let cachedVisibility = defaultVisibility;

function readVisibilitySnapshot(): WidgetVisibility {
  if (typeof window === "undefined") return defaultVisibility;

  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as Partial<WidgetVisibility>;
    const nextVisibility = Object.fromEntries(
      widgets.map((widget) => [widget.id, typeof saved[widget.id] === "boolean" ? saved[widget.id] : true]),
    ) as WidgetVisibility;

    if (widgets.some((widget) => cachedVisibility[widget.id] !== nextVisibility[widget.id])) {
      cachedVisibility = nextVisibility;
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

function updateVisibility(next: WidgetVisibility) {
  cachedVisibility = next;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // The in-memory preference still works when browser storage is unavailable.
  }

  window.dispatchEvent(new Event(visibilityEvent));
}

export function WidgetPreview() {
  const visibility = useSyncExternalStore(subscribe, readVisibilitySnapshot, () => defaultVisibility);
  const [editing, setEditing] = useState(false);

  function toggleWidget(id: WidgetId) {
    updateVisibility({ ...visibility, [id]: !visibility[id] });
  }

  const visibleWidgets = widgets.filter((widget) => visibility[widget.id]);

  return (
    <section aria-labelledby="dashboard-preview-title">
      <div className={styles.toolbar}>
        <div>
          <p className={styles.kicker}>Dashboard preview</p>
          <h2 id="dashboard-preview-title">A place for what matters now</h2>
        </div>
        <button
          type="button"
          className={styles.editButton}
          aria-expanded={editing}
          aria-controls="widget-visibility-controls"
          onClick={() => setEditing((current) => !current)}
        >
          <SlidersHorizontal size={17} aria-hidden="true" />
          {editing ? "Done" : "Edit widgets"}
        </button>
      </div>

      {editing ? (
        <Surface variant="subtle" className={styles.controls} id="widget-visibility-controls">
          <p>Choose which sections appear on Home.</p>
          <div className={styles.toggleList}>
            {widgets.map((widget) => (
              <button
                type="button"
                key={widget.id}
                className={styles.toggleButton}
                data-visible={visibility[widget.id] || undefined}
                aria-pressed={visibility[widget.id]}
                onClick={() => toggleWidget(widget.id)}
              >
                {visibility[widget.id] ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}
                {widget.title}
              </button>
            ))}
          </div>
        </Surface>
      ) : null}

      {visibleWidgets.length > 0 ? (
        <div className={styles.grid}>
          {visibleWidgets.map((widget) => {
            const Icon = widget.icon;
            return (
              <Surface key={widget.id} variant="glass" className={styles.widget}>
                <div className={styles.widgetTopline}>
                  <span className={styles.widgetIcon} aria-hidden="true"><Icon size={18} /></span>
                  <span className={styles.previewLabel}>Preview</span>
                </div>
                <h3>{widget.title}</h3>
                <p>{widget.description}</p>
                <div className={styles.placeholderLines} aria-hidden="true">
                  <span />
                  <span />
                </div>
              </Surface>
            );
          })}
        </div>
      ) : (
        <Surface variant="subtle" className={styles.emptyState}>
          <EyeOff size={20} aria-hidden="true" />
          <p>All preview widgets are hidden. Use Edit widgets to bring one back.</p>
        </Surface>
      )}
    </section>
  );
}
