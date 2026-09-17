import styles from "./app-shell.module.css";

const routeCopy: Record<string, { title: string; description: string }> = {
  "/": {
    title: "So, Ano Na?",
    description: "Checking what's happening today.",
  },
  "/tasks": {
    title: "Shit to Do",
    description: "Loading your priorities and deadlines.",
  },
  "/calendar": {
    title: "My Alleged Schedule",
    description: "Checking what's supposedly on the calendar.",
  },
  "/school": {
    title: "Academic Suffering",
    description: "Checking what Blackboard dropped.",
  },
  "/inbox": {
    title: "Unsorted Bullshit",
    description: "Loading the pile.",
  },
  "/focus": {
    title: "Lock In mofo",
    description: "Getting ready to focus.",
  },
  "/notes": {
    title: "Notes",
    description: "Opening your writing workspace.",
  },
  "/more": {
    title: "More",
    description: "Preferences, integrations, and WIP areas.",
  },
  "/anti-gastador": {
    title: "Anti-Gastador",
    description: "Loading financial caution.",
  },
  "/soon": {
    title: "Soon™",
    description: "Loading backlog vibes.",
  },
  "/consume": {
    title: "Things to Consume Before I Die",
    description: "Loading media pile.",
  },
  "/dear-dumbass": {
    title: "Dear Dumbass",
    description: "Loading thoughts and moments.",
  },
  "/lore": {
    title: "Lore",
    description: "Compiling canon events.",
  },
  "/people": {
    title: "These Mfs",
    description: "Loading people and connections.",
  },
  "/gala": {
    title: "Gala",
    description: "Packing luggage.",
  },
  "/football": {
    title: "Football (EFU)",
    description: "Checking the pitch.",
  },
  "/skills": {
    title: "Skills",
    description: "Checking skill tree.",
  },
  "/private": {
    title: "None of Your Business",
    description: "Opening local vault.",
  },
};

export function WorkspaceRouteShell({ path }: { path: string }) {
  const rootPath = `/${path.split("/").filter(Boolean)[0] || ""}`;
  const copy = routeCopy[rootPath] ?? {
    title: "Adulting.exe",
    description: "One sec. Preparing your workspace.",
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
