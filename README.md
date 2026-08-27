# Life OS (working title)

A personal, single-user productivity application intended to bring tasks, calendar, school, football, and selected external information into one calm interface. The name is provisional; architecture and domain boundaries should not depend on it.

## Current phase

**Phase 1B — Application shell and visual system.** The repository now includes the responsive workspace shell, shared primary navigation, placeholder routes, locally persisted appearance controls, reusable surface variants, and a lightweight hideable-widget preview. It still does not contain task management, a real calendar, school data, authentication, a database, or integrations.

## Stack

- Next.js 16 with the App Router
- React 19 and TypeScript
- Tailwind CSS 4
- Lucide React icons
- ESLint with Next.js Core Web Vitals and TypeScript rules
- Supabase/PostgreSQL-compatible boundaries for later data phases
- Vercel-compatible Next.js deployment

shadcn/ui is intentionally not installed yet. Phase 1B's controls are small native elements, so adding another component dependency would not simplify the current interface.

## Local development

Requires Node.js 20.9 or later and pnpm.

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the local development server |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Validate TypeScript without emitting files |
| `pnpm build` | Create a production build |
| `pnpm start` | Serve the production build |

## Environment setup

No environment variables are required in Phase 1B. Copy `.env.example` to `.env.local` only when a later phase introduces Supabase access:

```powershell
Copy-Item .env.example .env.local
```

Never commit real credentials. Browser-exposed variables must only contain values designed to be public; privileged service keys belong in server-only environment variables when a future data phase requires them.

## Repository map

- `src/app` — App Router routes, layouts, and global CSS entry
- `src/components` — reusable, domain-neutral UI
- `src/features` — feature-owned UI, local interaction state, and future business rules
- `src/hooks` — genuinely reusable React hooks
- `src/lib` — small framework-independent utilities and configuration
- `src/services` — data access and external integration boundaries
- `src/styles` — global semantic design tokens
- `src/types` — shared cross-feature types only
- `docs/ARCHITECTURE.md` — architectural decisions and future placement rules
- `AGENTS.md` — persistent instructions for coding agents

## Roadmap

- **Phase 1A:** Foundation and architecture
- **Phase 1B:** Application shell, navigation, theme system, and glass interface (current)
- **Phase 1C:** Tasks and persistence
- **Phase 1D:** Calendar and scheduled-task rendering
- **Phase 1E:** Home dashboard and widgets
- **Phase 1F:** School
- **Phase 1G:** Football and More
- **Phase 1H:** PWA and mobile polish
- **Phase 1I:** QA, accessibility, performance, and cleanup
- **Phase 1J:** Deployment

Later work will also cover Blackboard calendar data, Google Calendar, notifications, knowledge integrations, local AI, and optional cloud AI. None of those systems are implemented in this phase.
