# Architecture

## Goals

The repository is a deliberately small foundation for a personal, single-user application. It separates framework concerns, reusable interface code, feature ownership, and external systems without introducing speculative layers. The working product name is presentation copy, not an architectural namespace.

## Directory structure

```text
src/
  app/
    (workspace)/          Routes sharing the responsive application shell
  components/
    shell/                Domain-neutral shell and navigation composition
    ui/                   Reusable, domain-neutral interface components
  features/               Feature-owned UI, state, validation, and business rules
  hooks/                  Shared React hooks with more than one real consumer
  lib/
    theme/                Theme metadata such as supported accent palettes
  services/
    integrations/         Adapters for external systems
  styles/                 Global semantic design tokens
  types/                  Types shared across genuine domain boundaries
```

Folders should gain code only when a phase needs it. Do not create generic repositories, managers, or utility collections in anticipation of future work.

## Application shell and routing

The `(workspace)` route group applies `AppShell` to Home, Tasks, Calendar, School, and More without adding a URL segment. The shell remains a server component. Its small `AppNavigation` client boundary reads the pathname only to expose the active route; page content does not become client-rendered as a consequence.

Primary destinations are defined once in `src/lib/navigation.ts` and consumed by both the persistent desktop sidebar and safe-area-aware mobile tab bar. Mobile content reserves enough bottom space for the fixed bar. Desktop content is constrained to a readable frame and can expand into multi-column dashboard layouts.

Tasks, Calendar, and School routes are deliberately visual placeholders. More reserves clear entries for Football, Projects, Areas, and Integrations while keeping Appearance as the only functional section in this phase.

## Reusable UI and feature separation

`src/components/ui` is for visual primitives that do not know about tasks, school, football, or calendar semantics. A button, dialog, or generic surface belongs there. `src/features/<feature>` owns domain-specific components and rules. For example, a future task row belongs to `features/tasks`, even if it composes generic components from `components/ui`.

Feature business logic should be colocated with its feature rather than placed in pages or broad utility files. App Router files compose features and define routing; they should not become the primary business-logic layer.

## Design tokens and themes

`src/styles/tokens.css` is the visual contract. Components consume semantic values such as `--background`, `--surface`, `--text-primary`, `--accent`, `--accent-text`, `--border-subtle`, `--shadow-soft`, `--blur-surface`, radii, and motion durations. `--accent` is the palette identity for decoration; `--accent-text` mixes it toward the current primary text color so small accent-colored text and focus indicators retain contrast in both appearance modes. Components must not repeatedly hard-code a palette color.

Tailwind 4 theme mappings in that file expose the core semantic colors to utilities while raw custom properties remain available for CSS that needs shadows, blur, or motion. This keeps feature code independent from a particular aesthetic and makes a later redesign primarily a token change.

The foundation uses a native system-font stack. This avoids a network dependency during production builds, feels at home on Apple platforms, and remains readable on Windows. A bundled local brand font can replace it later without changing feature code.

Appearance is represented by `data-theme="system" | "light" | "dark"` on the root element. System mode uses `prefers-color-scheme`; explicit light and dark selectors override it. Phase 1B provides all three controls on More. A small synchronous bootstrap in the document head validates versioned browser-local preferences and applies root attributes before paint. Interactive controls subscribe to those attributes through a hydration-safe external-store boundary.

Accent selection uses `data-accent` and the centralized catalog in `src/lib/theme/palettes.ts`. Crimson, Ocean, Forest, Violet, and Graphite are initial options. Adding a palette means adding one catalog entry and its token values; feature components should not change.

Reusable `Surface` variants (`base`, `glass`, `elevated`, `subtle`, and `interactive`) centralize translucent backgrounds, borders, shadows, radii, and blur. Pages and features compose those variants instead of recreating glass styles or encoding palette colors.

Motion uses CSS where sufficient and includes a global `prefers-reduced-motion` safeguard. No animation library is installed. Translucent surfaces retain solid-enough backgrounds and borders so blur is decorative rather than required for readability.

## Responsive and accessibility foundations

Base styles target small screens first, use dynamic viewport units, include safe-area insets, and expand layouts through min-width media queries. The mobile tab bar uses icon-and-label targets sized for touch, remains fixed above the bottom safe area, and yields to the desktop sidebar at the shell breakpoint.

The root layout provides descriptive metadata and semantic HTML. Global focus-visible styling, readable foreground tokens, reduced-motion behavior, and Next.js accessibility linting establish defaults. New controls must still be checked for keyboard behavior, names, states, and contrast.

## Local UI preferences

Appearance and Home widget visibility are device-local UI preferences, not domain data. Their storage keys are versioned. The Home preview supports only visible/hidden state for Today, Upcoming, Current Projects, and School; it intentionally has no ordering, resizing, drag-and-drop, or server persistence. Phase 1C should not move these preferences into the first task schema unless a later product requirement calls for cross-device UI preference syncing.

## Services and integrations

External systems belong behind adapters under `src/services/integrations/<system>`. Planned examples include `google-calendar`, `blackboard`, `notion`, `obsidian`, and `ai`, but these directories should not contain mock clients before their phases begin.

Integration adapters should translate provider-specific payloads into explicit internal shapes and preserve source identity. They must not leak SDK objects throughout features. Secrets stay server-side. Client components should not call privileged provider APIs directly.

Blackboard is limited to calendar-related information unless requirements change. Announcement, grade, messaging, document, and general feed syncing are out of scope.

## Future data layer

Supabase is the anticipated hosted boundary and PostgreSQL is the target relational model. A future data phase can place browser/server clients under `src/services/supabase` and schema migrations in a root `supabase/` directory. Environment placeholders exist, but Phase 1B has no client, schema, or database dependency.

Data access should stay server-side by default and expose narrow operations to features. Do not create a large speculative schema. Add tables and constraints alongside the product phase that establishes their behavior.

## Future authentication

Authentication is intentionally absent. If private access is added later, session/client setup should live in a dedicated service boundary, request enforcement should use the current Next.js proxy convention if needed, and login UI should be isolated from feature logic. The current route and data structure do not assume an authenticated user object, so a simple access layer can be added without rewriting domain components.

## Tasks and calendar are separate domains

A task and a calendar event are different entities. A task may have a deadline or scheduled interval and may be rendered in a calendar view, but that rendering does not convert it into a standard calendar event. Calendar presentation should eventually consume a union or view model while persistence retains distinct task and event records.

External events remain source-aware so synchronization and updates can respect their provider. Blackboard calendar items must not automatically become normal tasks. Any explicit conversion or linking behavior requires its own later product decision.

## Principles to preserve

- Build only the current phase.
- Prefer server components until interaction requires a client boundary.
- Keep mobile behavior intentional and safe-area aware.
- Keep feature logic independent from palette and presentation themes.
- Reuse primitives and business rules instead of duplicating them.
- Add dependencies only for an immediate, concrete need.
- Keep integrations isolated and source-aware.
- Update this document when a material boundary changes.
- Run lint, TypeScript validation, and an appropriate production build before claiming meaningful work is complete.
