# Google Calendar setup

Forward’s first external calendar connection is read-only. The application requests only `https://www.googleapis.com/auth/calendar.readonly`, stores the resulting token envelope encrypted, and never exposes the client secret to the browser.

## Application configuration

1. In Google Cloud Console, create or select the project intended for Forward.
2. Enable **Google Calendar API** under APIs & Services.
3. Configure the OAuth consent screen. While the app is in testing, add the Forward account as a test user.
4. Create an **OAuth client ID** for a **Web application**.
5. Add this exact local authorized redirect URI:

   ```text
   http://localhost:3000/api/integrations/calendar/google/callback
   ```

   For deployment, add the same path beneath the canonical HTTPS production origin.

6. Put these values in `.env.local` without quotes:

   ```text
   APP_ORIGIN=http://localhost:3000
   GOOGLE_CALENDAR_CLIENT_ID=<web-client-id>
   GOOGLE_CALENDAR_CLIENT_SECRET=<web-client-secret>
   ```

`GOOGLE_CALENDAR_CLIENT_SECRET` and `INTEGRATION_CREDENTIAL_ENCRYPTION_KEY` are secrets. Never paste them into chat, expose them through a `NEXT_PUBLIC_` variable, or commit the populated file.

## Database and connection

Back up the linked Supabase project, then preview and apply pending migrations:

```powershell
pnpm exec supabase db push --dry-run
pnpm exec supabase db push
```

Never use `supabase db reset --linked` on a database containing data. Restart the development server after changing environment variables, sign in to Forward, open **More → Calendar connections**, and choose **Connect read-only**.

Successful consent establishes the encrypted account connection. Choose **Sync now** to discover every calendar in the account and mirror selected calendars into Forward. Newly discovered calendars are selected by default; selection controls are intentionally deferred until required.

## Synchronization behavior

- The initial sync uses a stable owner-time-zone horizon from 90 days before today through 365 days after today. That stable query is required for safe incremental Google sync tokens.
- Later syncs use each calendar's encrypted incremental cursor. A Google `410 Gone` response clears that cursor in memory and safely repeats a full sync for that calendar.
- Cancelled events become source-aware tombstones. Events absent from a full provider result receive `missing_since`; they are retained instead of being deleted.
- Access-token refresh uses a short owner-scoped database lease. Concurrent requests cannot overwrite one another's rotated encrypted token envelope.
- Provider records remain read-only and cannot open the native event editor. Syncing never creates or converts native tasks, work sessions, or calendar events.

The migration and OAuth configuration must be applied before runtime proof is possible. A successful fixture test or production build does not prove Google consent, token refresh, or live Calendar API access.
