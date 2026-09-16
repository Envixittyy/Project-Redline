import { WorkspaceRouteShell } from "@/components/shell/workspace-route-shell";

/**
 * Shown while the Tasks route resolves. The route reads from Supabase on every
 * request, so this is the loading state for both first load and view changes.
 */
export default function TasksLoading() {
  return <WorkspaceRouteShell path="/tasks" />;
}
