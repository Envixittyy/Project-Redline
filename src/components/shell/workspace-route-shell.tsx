import styles from "./app-shell.module.css";

const routeCopy: Record<string, { title: string; description: string }> = {
  "/": {
    title: "Home",
    description: "Bringing your plan, schedule, and priorities into focus.",
  },
  "/tasks": {
    title: "Tasks",
    description: "Preparing your focused task workspace.",
  },
  "/calendar": {
    title: "Calendar",
    description: "Aligning events, classes, and scheduled work.",
  },
  "/school": {
    title: "School",
    description: "Gathering courses, meetings, and academic activity.",
  },
  "/notes": {
    title: "Notes",
    description: "Opening your writing workspace and linked context.",
  },
  "/more": {
    title: "More",
    description: "Preparing settings, integrations, and preferences.",
  },
};

export function WorkspaceRouteShell({ path }: { path: string }) {
  const rootPath = `/${path.split("/").filter(Boolean)[0] || ""}`;
  const copy = routeCopy[rootPath] ?? {
    title: "Forward",
    description: "Preparing your workspace.",
  };

  return (
    <section
      className={styles.routeShell}
      aria-busy="true"
      aria-label={`Loading ${copy.title}`}
    >
      <header className={styles.routeShellHeader}>
        <div>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <span className={styles.routeShellAction} aria-hidden="true" />
      </header>
      <div className={styles.routeShellToolbar} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className={styles.routeShellGrid} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <span className="sr-only">Loading {copy.title}</span>
    </section>
  );
}
