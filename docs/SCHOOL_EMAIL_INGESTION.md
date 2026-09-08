# Phase S1 School email ingestion

S1 implements Blackboard notification → school Outlook forwarding/redirect →
Postmark → authenticated inbound route → normalized email → deterministic
Blackboard event → course/item resolution → atomic School and Task persistence.
Blackboard Calendar sync is removed. No AI, mailbox scraping, grade sync, file
ingestion, calendar reconciliation or background worker is required.

## Implementation map and reuse

- Existing `courses`, `course_meetings`, `tasks`, Task status/deadline semantics,
  authenticated repositories, service-role maintenance client, SQL migrations,
  PGlite, Vitest and `lib/date/day.ts` are reused.
- Existing Blackboard `external_records` are calendar mirrors with Universal
  Capture history, not email assignment objects. Their mapping table requires a
  feed account/credential. They remain historical data, without active sync.
- No email/MIME/webhook provider existed. Postmark supplies decoded text, HTML,
  structured addresses and headers; only its small adapter knows Postmark fields.
- `html-to-text` handles HTML/character entities and links; Zod validates payloads.
  See `THIRD_PARTY.md` for versions, licenses and provider comparison.

## Real-world setup

1. Apply all repository migrations, including
   `20260908090000_school_email_ingestion.sql`, to the intended Supabase project
   using the normal migration process. No hosted database was modified here.
2. Configure an inbound Postmark message stream. Use its supplied inbound address
   or set up the provider's documented inbound domain/DNS records for a custom
   domain. A custom domain is optional; no DNS was changed here.
3. Set the inbound webhook to the HTTPS application path
   `/api/inbound/postmark`. Configure Basic authentication using the chosen
   username and a random password of at least 32 characters. Postmark documents
   credential-bearing webhook URLs; enter credentials only in its protected
   configuration, never in source, screenshots or logs. Restrict ingress to
   Postmark's current IP ranges at the deployment firewall when available.
4. Set server-only environment variables:
   - `POSTMARK_WEBHOOK_USERNAME`, `POSTMARK_WEBHOOK_PASSWORD`.
   - `SCHOOL_EMAIL_OWNER_ID`: the existing Supabase Auth user's UUID.
   - `SCHOOL_EMAIL_RECIPIENT`: exact Postmark `OriginalRecipient` address.
   - `SCHOOL_BLACKBOARD_SENDERS`: comma-separated exact notification mailboxes.
   - `SCHOOL_EMAIL_FORWARDERS`: comma-separated exact school Outlook mailboxes.
   - `SCHOOL_BLACKBOARD_HOSTS`: exact trusted Blackboard hostnames, no wildcards.
   - Existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for verified ingress.
   - Existing `APP_TIME_ZONE` if different from the default `Asia/Manila`.
5. Configure Outlook to forward or redirect only the intended Blackboard
   notifications. Do not forward the entire mailbox. Normal forwarding must
   preserve the original From/Subject block and preferably its offset-bearing
   Sent/Date. Redirects normally retain Blackboard as sender.
6. Verify a real anonymized sample against the deployment before relying on it.
   The adapter requires one Postmark-generated `X-Spam-Status: No` and an
   `X-Spam-Tests` result containing `DKIM_VALID_AU` (aligned author DKIM).
   Absent or duplicate evidence fails closed as `ignored`; SPF alone is not
   accepted. Verify that the school's direct/forwarded delivery produces this
   evidence. A redirect that breaks DKIM must be corrected at delivery setup;
   do not bypass this check or trust arbitrary Authentication-Results headers.
7. Send one assignment, repeat delivery, then send a deadline change. Check one
   School item/Task, stable IDs, matching due dates and a safe Blackboard URL.

Provider credentials, Outlook rules, live email samples, DNS, deployment variables
and the hosted migration have **not** been provisioned or verified by this task.
Postmark account retention is separate from Redline retention and should be set
to the operator's chosen mailbox-data policy.

## Parsing and temporal contract

The parser recognizes explicit Course/Title/Item Type/Due Date labels and bounded
subject headings. It handles plain text, HTML-only messages, inline Outlook
forwarding and redirected messages with the original sender. Links are never
fetched. Only HTTPS links on configured exact Blackboard hosts survive; tracking
parameters are removed without losing course/content identifiers.

Supported item types: `assignment`, `quiz`, `exam` (including test), `material`,
`announcement`, `course_opened`, `unknown`. Notification types additionally include
`deadline_changed` and `reminder`. Announcements take informational precedence.
Unknown/digest/multiple-item messages fail safely rather than generating tasks.
Course-opened notices resolve existing courses or remain `unresolved_course` for
review; automatic course creation is not performed.

Dates require an explicit ISO calendar date or English month/day/year. Optional
times may use AM/PM, numeric offsets, UTC, or an IANA timezone. An explicit clock
without a zone uses the configured workspace zone. Ambiguous numeric dates,
relative dates, timezone abbreviations, invalid days and DST gaps are unresolved.
Date-only input produces `due_date` with **null** `due_at`; timed input produces a
UTC instant and its workspace-local calendar day. No exam time is invented.

Only explicit labelled percentage weights are retained. Other numbers, grades
and point totals are not interpreted as weighting. MIME attachment-forwarding
(`.eml` attachments), arbitrary localized templates, course-code extraction from
unstructured prose and multi-item digests are not implemented. Postmark handles
MIME decoding; Redline discards attachments and does not silently parse them.

## Identity, ordering and transactions

- Message uniqueness: `(user_id, provider, provider_message_id)` plus a SHA-256
  message key using normalized sender and original Message-ID where available.
  Changed forwarding wrappers also converge through logical-item identity.
- Course resolution: saved host/course mapping, then unique normalized exact
  course code, then unique normalized exact course name. Archived/ambiguous
  courses remain unresolved. No global fuzzy matching occurs.
- Item resolution: course-scoped Blackboard content/assessment/assignment ID or
  canonical item URL. Normalized course/type/title is an ambiguity guard, not an
  identity: when either side lacks a strong key, a same-title candidate remains
  unresolved instead of being auto-merged. Different strong IDs sharing a title
  remain separate.
- Task identity: a unique relational `school_items.task_id`, plus `task_created`
  preserving the fact that a Task existed even after user deletion. Retry never
  silently recreates a deleted Task. Completed/submitted/cancelled statuses,
  user Task titles and personal work schedules are preserved.
- One transaction locks the owner's ingestion stream, resolves canonical data,
  records processing state, writes the item/Task and saves a reliable course
  mapping. Any exception rolls everything back and returns HTTP 500 for provider
  retry. Known malformed/unknown/unresolved parsed messages are retained and
  acknowledged with HTTP 200, avoiding endless delivery retries.
- A matched deadline-change notice updates both deadlines. Older source-time
  changes are `stale`; conflicting equal-time changes are unresolved. Deadline
  changes without reliable source time or deadline fail closed. Reminders cannot
  roll back a known deadline. Later reliable messages may fill a missing date.
  An unmatched reminder/change stays unresolved until ID-only retry can match it.
- Materials, announcements and known course-opened notices are recent School
  activity rows with no Task. The old inert `announcements` table is not activated.

## Security and operational records

Basic authentication is checked before reading/parsing the bounded 512 KiB body.
Zod bounds fields; a 128,000-character limit applies to each text/HTML body.
Recipient, sender/forwarder, delivery evidence and URL host checks are separate.
No payload field can choose the owner or grant trusted Blackboard status.

Only `service_role` can call `ingest_school_email` or write School items/event
evidence. The ordinary authenticated client can read its own rows and manage
owner-consistent mappings. `retry_school_email_event(id)` is a narrow definer
function: it checks `auth.uid()` and reuses only immutable persisted evidence.
It cannot accept replacement parsed text or a user ID. Relationship triggers
check course, item and Task owner equality even for privileged ingress writes.

Stored events contain only selected parsed fields, parser version, source IDs,
source/receipt timestamps, status and up to 2,000 characters of selected evidence.
Original bodies/HTML, attachments, arbitrary headers and credentials are not
persisted. Ignored untrusted messages retain IDs/status only, without subject/body
evidence. Logs contain bounded outcome codes and record IDs, never body text or
raw database/provider errors. Unparseable JSON/oversize/invalid provider shapes
produce a redacted operational log and 422/413; they are not trusted School rows.
No automatic audit purge is added: minimized provenance remains to support item
identity and review. Raw mail retention is the provider's separate responsibility.

## Gemini UI / QA contract

Use `src/types/school-item.ts` and server-only
`src/services/school/school-repository.ts`; never import the admin client or the
provider adapter into UI code.

| Boundary | Result / usage |
| --- | --- |
| `listSchoolItems(courseId?)` | Latest 200 `SchoolItem` rows, optional canonical course filter. |
| `listSchoolEmailEvents()` | Latest 100 outcomes, selected `parsedEvent` evidence, optional `itemId`, and canonical `courseId` resolved through the persisted School item. |
| `saveSchoolCourseMapping(sourceCourseKey, courseId)` | Owner-checked mapping; take the key from the selected event. |
| `retrySchoolEmailEvent(eventId)` | ID-only retry of stored unresolved evidence. Returns status, eventId, itemId, taskId. |
| `mapSchoolEmailCourseAction` / `retrySchoolEmailAction` | Validating Server Actions returning `{ok:true,...}` or `{ok:false,message}`; retry revalidates School, Tasks, Calendar and Home. |

`SchoolItem`: `id`, `courseId`, `itemType`, `title`, optional/null `dueDate`,
`dueAt`, `sourceUrl`, `weight`, `taskId`, plus `createdAt`/`updatedAt`. Course ID
refers to the existing courses repository; Task ID opens the ordinary Task editor.
School items are not calendar events. Render persisted evidence as text, never
raw HTML. A null Task is normal for informational items and for a deleted link.

Outcome values: `processed`, `duplicate` (response only), `ignored`, `unknown_type`,
`malformed`, `unresolved_course`, `unresolved_item`, `unresolved_task`, `stale`.
`received` exists only inside the transaction and is not exposed as a completed
outcome. The parsed event's own status is `parsed`, `ignored`, `unknown_type` or
`malformed`; show the persisted outcome for actual ingestion state.

Unresolved course: show extracted course hint and mapping picker, save mapping,
then retry that event. Unresolved item/Task: show evidence and existing links for
manual inspection; do not invent a new Task. Unknown/malformed events do not have
an editable arbitrary-JSON ingestion endpoint. UI pagination beyond the bounded
recent lists is not included in S1 core. No School/Course presentation was changed.

Synthetic fixtures are in
`src/services/integrations/blackboard/fixtures/email-fixtures.ts`. Run:

```text
pnpm test src/services/integrations/blackboard/email-parser.test.ts src/services/school/school-ingestion.integration.test.ts src/app/api/inbound/postmark/route.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The integration test loads **all actual migrations** into PGlite, uses the
service-role and authenticated database roles, and verifies rollback/retry,
ownership/grants, message/item/Task identity and source ordering. No production
credentials are needed. Live distributed concurrency and actual provider/school
templates still require the deployment acceptance check above.

## Verification performed (2026-09-08)

- `pnpm lint`: passed with three existing unused-variable warnings in unrelated
  AI service files; no lint errors.
- `pnpm typecheck`: passed. The first run exposed an existing missing `catch`
  binding in `contextual-assistant-modal.tsx`; the one-line repair restores its
  error handler and is the only unrelated compatibility fix.
- `pnpm test`: 809 passed, 2 skipped; 88 passing files and one skipped live RLS
  integration file. School tests use actual migrations with PGlite. The initial
  sandbox attempt could not open Vitest (`EPERM`); the suite ran successfully
  through the approved unrestricted test command.
- `pnpm build`: passed, including `/api/inbound/postmark`.
- `pnpm audit --prod --json`: zero known advisories at check time.
- `git diff --check`: passed.
