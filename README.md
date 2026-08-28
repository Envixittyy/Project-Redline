# Life OS (working title)

A personal, single-user productivity application intended to bring tasks, calendar, school, football, and selected external information into one calm interface. The name is provisional; architecture and domain boundaries should not depend on it.

## Current phase

**Phase 1G-B — authenticated owner-scoped persistence.** Supabase Auth sessions are stored in secure cookies, the workspace is server-protected, and task/calendar access runs through the authenticated user with PostgreSQL RLS enforcing ownership. Existing rows have a controlled service-role-only backfill path.

The repository still contains no persisted school data, recurring events or tasks, habits, or external synchronization. Blackboard and Google Calendar are represented only as future-safe event source values.

## Stack

- Next.js 16 with the App Router
- React 19 and TypeScript
- Tailwind CSS 4
- Supabase Auth and PostgreSQL for cookie-backed sessions and owner-scoped task/calendar persistence
- Lucide React icons
- ESLint with Next.js Core Web Vitals and TypeScript rules
- Vercel-compatible Next.js deployment

shadcn/ui is intentionally not installed yet. Phase 1B's controls are small native elements, so adding another component dependency would not simplify the current interface.

## Local development

Requires Node.js 22 or later and pnpm.

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
| `pnpm backfill:owner` | Run the controlled existing-row owner backfill |

## Environment setup

Authentication, Tasks, and Calendar require Supabase. Copy the example file and fill in the public project values:

```powershell
Copy-Item .env.example .env.local
```

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public Supabase project URL used by cookie-backed clients |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public project key; access remains restricted by RLS |
| `APP_TIME_ZONE` | Optional IANA zone deciding what "today" means. Defaults to the server's zone, so set it when deploying |

The server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are required only for the controlled owner backfill and isolated RLS integration tests. They are not used by normal feature repositories.

Apply schemas in `supabase/migrations` in filename order, then follow [the Supabase Auth and owner-backfill runbook](docs/SUPABASE_AUTH.md) before opening the application to normal traffic.

Without the public variables, the private workspace fails closed at the login surface. Never commit real credentials.

### Access model

`tasks` and `calendar_events` carry `user_id` ownership. Authenticated CRUD uses a request-scoped publishable-key client, and RLS permits only rows where `auth.uid() = user_id`. Anonymous and cross-owner access are denied. The service role exists solely for explicitly named maintenance operations.

## Repository map

- `src/app` — App Router routes, layouts, and global CSS entry
- `src/components` — reusable, domain-neutral UI
- `src/features` — feature-owned UI, local interaction state, and future business rules
- `src/hooks` — genuinely reusable React hooks
- `src/lib` — small framework-independent utilities and configuration
- `src/services` — data access and external integration boundaries
- `supabase/migrations` — SQL schema history
- `src/styles` — global semantic design tokens
- `src/types` — shared cross-feature types only
- `docs/ARCHITECTURE.md` — architectural decisions and future placement rules
- `AGENTS.md` — persistent instructions for coding agents

## Roadmap

- **Phase 1A:** Foundation and architecture
- **Phase 1B:** Application shell, navigation, theme system, and glass interface
- **Phase 1C:** Tasks and persistence
- **Phase 1D:** Calendar and scheduled-task rendering
- **Phase 1E:** Home dashboard and widgets
- **Phase 1F:** School
- **Phase 1G:** Authentication boundary and More (current)
- **Phase 1H:** PWA and mobile polish
- **Phase 1I:** QA, accessibility, performance, and cleanup
- **Phase 1J:** Deployment

Later work will also cover Blackboard calendar data, Google Calendar, notifications, knowledge integrations, local AI, and optional cloud AI. None of those systems are implemented in this phase.
