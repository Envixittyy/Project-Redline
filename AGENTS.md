<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Repository instructions

## Product rules

- This is primarily a personal, single-user application. Do not introduce multi-tenant or commercial-product complexity without an explicit requirement.
- Mobile, especially iPhone-sized displays and touch input, is a first-class platform.
- Do not build unspecified features or implement future phases opportunistically.
- Prefer the smallest clear architecture that supports the current phase.
- The working product name may change. Keep architectural concepts product-name agnostic.

Life OS is being developed incrementally. Implement only functionality explicitly included in the current task or phase.

## Navigation

Planned mobile navigation is Home, Tasks, Calendar, School, and More. Desktop may use an appropriate sidebar or larger-screen navigation system. Not every feature needs a primary-navigation item.

## Mobile

Account for touch targets, small screens, safe areas, responsive layouts, future bottom navigation, and future PWA use. Do not simply shrink desktop interfaces.

## Tasks and calendar

- Tasks and calendar events are separate entities.
- A task may have a deadline, have a scheduled time, and appear visually on a calendar. Rendering it on a calendar does not turn it into an ordinary calendar event.
- External calendar events must remain source-aware.
- Blackboard calendar items must not automatically become standard application tasks.
- A task may also have a scheduled start/end, project relationship, or area relationship without becoming an ordinary calendar event.
- Do not automatically convert external calendar events into application tasks.

## Blackboard scope

- Blackboard functionality is planned only for calendar-related information.
- Do not build announcement, grade, messaging, document, or general feed synchronization unless product requirements explicitly change.
- Future Blackboard synchronization should initially be one-way: Blackboard → Life OS.

## Football and projects

- Football is part of the product but may initially exist as an Area or secondary section; do not deeply hard-code the East Football United external URL in feature UI.
- Keep project management simple initially. Advanced project-management functionality is deferred.

## Deferred features

Habits and recurring tasks are later features and must not be implemented prematurely.

## Engineering

- Inspect the existing code and documentation before making architectural changes.
- Preserve existing behavior unless a requested change requires otherwise.
- Avoid unrelated modifications, duplicate components, duplicate business logic, giant utility files, and unnecessary dependencies.
- Prefer root-cause fixes and straightforward code over speculative abstraction.
- Keep reusable UI in `src/components`; keep feature-specific UI and logic in `src/features`.
- Isolate external systems behind `src/services/integrations` boundaries.
- Never expose secrets or commit populated local environment files.
- Update `docs/ARCHITECTURE.md` when architecture changes materially.
- Use semantic design tokens. Feature code must not encode a permanent palette or visual theme.
- Prefer modern App Router conventions and server components by default. Add client components only where interaction or browser APIs require them.
- Before adding a substantial dependency, confirm it solves a current requirement, prefer maintained libraries, avoid overlap, and document non-obvious additions.
- Before editing, inspect relevant files and existing patterns. After editing, inspect the diff and remove dead code.

## Validation

For meaningful changes, run:

1. `pnpm lint`
2. `pnpm typecheck`
3. Relevant tests, when tests exist
4. `pnpm build` when production behavior may be affected

Never claim a check passed unless it was actually run.

## Completion reports

For substantial tasks, report what changed, important files, architecture decisions, dependencies, verification performed, known limitations, and considerations for the next phase. Never silently continue into a later development phase.
