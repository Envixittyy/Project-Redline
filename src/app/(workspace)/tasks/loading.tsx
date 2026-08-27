import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";

import styles from "./tasks-page.module.css";

/**
 * Shown while the Tasks route resolves. The route reads from Supabase on every
 * request, so this is the loading state for both first load and view changes.
 */
export default function TasksLoading() {
  return (
    <>
      <PageHeader
        title="Tasks"
        description="A focused home for what needs doing. A task can carry a deadline and a scheduled time without becoming a calendar event."
      />
      <Surface variant="base" className={styles.skeleton} aria-busy="true" aria-label="Loading tasks">
        <span />
        <span />
        <span />
      </Surface>
    </>
  );
}
