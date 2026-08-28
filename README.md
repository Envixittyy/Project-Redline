# Forward

A private, single-user personal command center for tasks, calendar, school, notes, and carefully bounded integrations. **Be curious, not judgmental.** Project Redline remains the internal engineering codename; architecture and domain boundaries do not depend on either name.

## Current state

The authenticated owner-scoped foundation is implemented. Supabase Auth sessions use secure cookies, the workspace is protected, and normal persistence runs through the authenticated user with PostgreSQL RLS enforcing ownership. Tasks, native calendar events, School courses/meetings, Notes/attachments, offline mutation groundwork, and secure Blackboard calendar-feed synchronization exist. Habits and recurring tasks remain deferred.

The current checkpoint fixes the Blackboard network blocker and defines architecture contracts for the later P1–P12 implementation roadmap. See [Forward architecture](docs/FORWARD_ARCHITECTURE.md) and the [Qwen implementation handoff](docs/QWEN_HANDOFF.md).

## Stack

- Next.js 16 with the App Router
- React 19 and TypeScript
- Tailwind CSS 4
- Supabase Auth and PostgreSQL for cookie-backed sessions and owner-scoped persistence
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
| `pnpm exec supabase db push --dry-run` | Preview pending migrations for the linked Supabase project |
| `pnpm exec supabase db push` | Apply pending migrations to the linked Supabase project |

## Environment setup

Authentication, Tasks, and Calendar require Supabase. Copy the example file and fill in the public project values:

```powershell
Copy-Item .env.example .env.local
```

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public Supabase project URL used by cookie-backed clients |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public project key; access remains restricted by RLS |
| `INTEGRATION_CREDENTIAL_ENCRYPTION_KEY` | Server-only key used to encrypt private integration credentials; never prefix it with `NEXT_PUBLIC_` |
| `APP_TIME_ZONE` | Optional IANA zone deciding what "today" means. Defaults to `Asia/Manila` |

The server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are required only for the controlled owner backfill and isolated RLS integration tests. They are not used by normal feature repositories.

Use the committed Supabase CLI configuration to apply `supabase/migrations`, then follow [the Supabase Auth and owner-backfill runbook](docs/SUPABASE_AUTH.md) before opening the application to normal traffic. A configured Auth project without these migrations can sign users in but cannot serve the protected workspace.

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
- `docs/FORWARD_ARCHITECTURE.md` — cross-phase product, security, and provider contracts
- `docs/QWEN_HANDOFF.md` — bounded implementation roadmap and review checkpoints
- `AGENTS.md` — persistent instructions for coding agents

## Roadmap

The next implementation cycle is deliberately phased: P1 visual system; P2 Capture/Inbox; P3 Calendar work sessions and providers; P4 Blackboard UI/reliability; P5 Notion; P6 AI provider/local companion/cloud fallback; P7 image ingestion; P8 deterministic planning; P9 Focus/Goldfish Mode; P10 routines/projects/areas/goals/daily notes; P11 custom views/review/analytics; and P12 production polish. Do not silently continue into a later phase.
