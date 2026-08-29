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

Successful consent currently establishes the encrypted account connection. Calendar discovery, refresh serialization, and event synchronization are the next P3 checkpoint; the UI does not claim that mirrored events are current before those operations exist.
