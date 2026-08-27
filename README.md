# Life OS (working title)

A personal, single-user productivity application intended to bring tasks, calendar, school, football, and selected external information into one calm interface. The name is provisional; architecture and domain boundaries should not depend on it.

## Current phase

**Phase 1D — Calendar and scheduled-task rendering.** Calendar provides responsive Month, Week, and Agenda views backed by native Life OS events and a read-time projection of scheduled tasks. Native events support create, edit, and delete. Scheduled tasks remain task rows, expose completion state, and open the existing task editor for rescheduling. Due-only tasks render as visually separate deadline indicators.

The repository still contains no school data, authentication, recurring events or tasks, habits, or external synchronization. Blackboard and Google Calendar are represented only as future-safe event source values.

## Stack

- Next.js 16 with the App Router
- React 19 and TypeScript
- Tailwind CSS 4
- Supabase (PostgreSQL) for task and calendar-event persistence, accessed server-side only
- Lucide React icons
- ESLint with Next.js Core Web Vitals and TypeScript rules
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

Tasks and Calendar require Supabase. Copy the example file and fill in the two server-side values:

```powershell
Copy-Item .env.example .env.local
```

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Your project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key. Never prefix it with `NEXT_PUBLIC_` |
| `APP_TIME_ZONE` | Optional IANA zone deciding what "today" means. Defaults to the server's zone, so set it when deploying |

Then apply the schemas in `supabase/migrations` to your project in filename order, either with the Supabase CLI (`supabase db push`) or by running the SQL files in the Supabase SQL editor.

Without these variables the Tasks and Calendar pages render setup notices instead of failing, and the rest of the app works normally.

Never commit real credentials. Browser-exposed variables must only contain values designed to be public; the service role key is read only in server code and is never sent to the browser.

### Access model

Phase 1D has no authentication. The `tasks` and `calendar_events` tables have row level security enabled with **no policies**, so the anon key can read nothing. All access goes through Next.js server code using the service role key, which bypasses RLS. See `docs/ARCHITECTURE.md` for how authentication will be introduced later.

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
- **Phase 1D:** Calendar and scheduled-task rendering (current)
- **Phase 1E:** Home dashboard and widgets
- **Phase 1F:** School
- **Phase 1G:** Football and More
- **Phase 1H:** PWA and mobile polish
- **Phase 1I:** QA, accessibility, performance, and cleanup
- **Phase 1J:** Deployment

Later work will also cover Blackboard calendar data, Google Calendar, notifications, knowledge integrations, local AI, and optional cloud AI. None of those systems are implemented in this phase.
