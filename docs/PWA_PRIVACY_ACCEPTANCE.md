# PWA privacy manual acceptance test

Status: not executed. This plan requires an interactive browser with two test accounts where available.

1. Sign in to account A.
2. Visit Home, Notes, Tasks, and one other page containing private content.
3. Allow the service worker to install and activate normally.
4. Create an offline-capable pending mutation, then return online and confirm normal synchronization still works.
5. Sign out.
6. In browser storage tools, confirm legacy `life-os-*` and `redline-*` caches are absent except for `redline-static-v2`, which contains only public static assets.
7. Confirm the `mutations` store in `life-os-offline-v1` contains no account A records.
8. Disable network access.
9. Attempt to navigate to the previously visited private routes.
10. Verify the browser shows the generic offline response and none of account A's content.
11. Restore network access.
12. Sign in as account B, where available.
13. Verify no account A content or queued mutations appear.
14. Verify appearance and dashboard-layout preferences remain unchanged.
