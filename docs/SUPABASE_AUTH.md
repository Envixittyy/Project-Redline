# Supabase Auth and owner-backfill runbook

## Required Auth setup

Enable email/password authentication in the Supabase project and create the intended application user before backfilling existing rows. Set the Supabase Site URL to the deployed application origin. For local development, allow `http://localhost:3000`. This phase uses password sign-in directly and does not add an OAuth or email callback route.

Set these normal application variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

The publishable key is expected in the browser/server SSR boundary. It is not a secret; table isolation depends on the owner policies in `20260828160000_owner_scoped_rls.sql`.

## Migration and existing-row backfill

The Supabase CLI is installed as a development dependency and `supabase/config.toml` is committed without secrets. For a new hosted development project, authenticate the CLI and link this checkout to the project reference shown in the Dashboard URL:

```powershell
pnpm exec supabase login
pnpm exec supabase link --project-ref <project-ref>
```

Preview the pending migration set before changing the remote database, then apply it:

```powershell
pnpm exec supabase db push --dry-run
pnpm exec supabase db push
```

`db push` records migration timestamps remotely and applies only pending files in `supabase/migrations`. Do not use `supabase db reset --linked`: that command drops and rebuilds the linked remote schema. A fresh project should receive all committed migrations, including the private Storage bucket and its policies.

Back up any project that already contains application data before changing ownership. The Phase 1G-B migration performs these safe first-stage actions:

1. Adds nullable `user_id` foreign keys and supporting indexes.
2. Enables owner-only RLS policies immediately. Existing ownerless rows become inaccessible to normal users but are not deleted.
3. Adds service-role-only backfill and finalization RPCs.

Resolve the intended UUID from the Supabase Auth Users page or an administrative API. Do not put that identity in source control. During a maintenance window, set the three administrative environment variables in the current shell:

```powershell
$env:SUPABASE_URL = "<project-url>"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service-role-key>"
$env:OWNER_USER_ID = "<auth-user-uuid>"
pnpm backfill:owner
```

The first run verifies that the UUID belongs to the project, updates only rows whose `user_id` is null, and reports ownerless counts. Both table updates occur in one database transaction. Re-running it is safe because already-owned rows are unchanged. Run this even on a new empty project so the final step can enforce `NOT NULL` ownership on `tasks` and `calendar_events`.

Review the reported counts and confirm the intended owner can see the existing records. Then enforce non-null ownership:

```powershell
pnpm backfill:owner -- --finalize
```

The finalizer recounts both tables and refuses to add `NOT NULL` if any ownerless row remains. Remove the three populated administrative values from the shell or local environment after completion.

## Failure and recovery

- A failed backfill RPC rolls back both table updates automatically.
- A failed finalizer leaves ownership nullable; fix the ownerless rows and retry.
- If the wrong owner was selected, stop before finalization and restore the pre-migration backup or correct the affected `user_id` values with an audited service-role SQL operation during the same maintenance window. Do not clear ownership while normal writes are active.
- Do not drop/reseed either table as a recovery technique.

## Client trust boundaries

- `src/services/supabase/browser.ts` is the public browser client boundary when a feature genuinely needs it.
- `src/services/supabase/request.ts` creates a fresh cookie-backed SSR client per request and verifies claims before returning the user ID.
- `src/services/supabase/admin.ts` is server-only and contains the only application service-role constructor. Feature repositories must not import it.
- Root `proxy.ts` refreshes cookies before rendering. It is not the authorization boundary: the workspace layout and every repository call verify authentication independently.

## RLS verification

Deterministic tests check the committed policy/backfill contract on every test run. Live PostgreSQL policy enforcement requires an isolated local/test Supabase project with all migrations applied. Set only these test variables:

```text
SUPABASE_RLS_TEST_URL
SUPABASE_RLS_TEST_PUBLISHABLE_KEY
SUPABASE_RLS_TEST_SERVICE_ROLE_KEY
```

Then run `pnpm test`. The integration test creates two temporary confirmed users, verifies same-owner CRUD, cross-owner denial, forged-owner insert denial, and anonymous read denial for both tables, then removes its rows and identities. Without these explicit test variables, the live test is skipped and must be reported as requiring configured Supabase verification.
