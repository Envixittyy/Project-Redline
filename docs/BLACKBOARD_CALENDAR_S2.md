# Blackboard Calendar S2

## Scope and release state

S2 adds Blackboard Calendar as a secondary current-state signal for the same
canonical School items and ordinary Tasks managed by S1 email ingestion. It does
not modify the S1 endpoint, normalization, parser, identity rules,
`ingest_school_email`, or email security boundary. It contains no AI and creates
no new task-like or school-item-like canonical model.

The implementation is safe to deploy with all accounts off. Connecting a feed
enters observe mode. Apply mode is intentionally not available in the product UI
and can only be activated through a service-role operator path after the live
acceptance gates below pass. There is no scheduled S2 runner.

This repository was developed without access to the owner's private Blackboard
feed. The committed fixture is explicitly synthetic and tests format semantics;
it is not evidence of a production Blackboard property shape. A redacted live
characterization path is implemented so actual provider evidence can be gathered
without logging the bearer URL or event values. Until that is completed, apply
mode is not accepted for production.

## Runtime flow

```text
encrypted private feed URL
  -> exact configured host + public DNS classification
  -> DNS-pinned HTTPS, same-allowlist redirects, 10 s total timeout, 2 MB limit
  -> node-ical parses already-fetched text
  -> bounded normalized complete snapshot
  -> service-role reconciliation under the exact S1 owner advisory lock
  -> external_records observations + sync_runs/sync_changes audit
  -> observe: proposals only | apply: same school_items and linked Tasks
```

`BlackboardCurrentStateAdapter` is the provider boundary. A supported REST source
can implement the same complete-snapshot contract later without changing School
reconciliation. The current adapter is ICS-only. `node-ical` network and file
helpers are never used.

The fetch fails closed on malformed URLs, credentials in URLs, non-HTTPS ports,
unconfigured hosts, any private/reserved/malformed DNS answer, redirect host
changes outside the allowlist, incomplete responses, timeouts, oversized bodies,
unexpected content types, and malformed calendars. Missing-source processing runs
only inside a successfully parsed and atomically reconciled complete snapshot.

## Observation and canonical identity

- `(account_id, external_uid)` is the stable identity of one calendar
  observation. A missing provider UID rejects the event; no mutable fallback UID
  is invented.
- Many calendar observations may link to one `school_items.id`. The link is not
  globally unique because Blackboard may expose multiple views of the same work.
- Exact S1 `source_key` and `course_key` mappings take precedence. Exact saved
  Blackboard mappings and then one unique normalized course code/name are allowed
  for course resolution.
- A compatible title/type without a shared source identity is an ambiguity guard,
  never permission to merge. Conflicts remain reviewable.
- Recurrence, cancelled events, unsupported types, floating time, contradictory
  course evidence, and non-unique courses remain observed/unresolved rather than
  guessed.

Assignments, quizzes, and exams with deterministic course and item identity are
actionable. In apply mode a genuinely new actionable item creates one School item
and one linked ordinary Task in the reconciliation transaction. Materials,
announcements, recurrence, and unknown types cannot create Tasks.

## Cross-channel ordering

Both S1 email ingestion and S2 reconciliation acquire:

```sql
pg_advisory_xact_lock(hashtextextended('school-email:'||p_user_id::text,0))
```

This serializes canonical School/Task mutation per owner. The tested ordering
rules are:

- Email first: the first calendar sighting links to the existing School item and
  preserves its non-null email deadline.
- Calendar first: a later email resolves the same source key and retains the same
  School item and Task IDs.
- Repeated or unchanged calendar state updates observation liveness only and
  cannot roll back a newer email deadline.
- A later materially changed calendar observation may converge the linked School
  item and Task deadline.
- A user-deleted Task is not recreated. The observation becomes
  `unresolved_task` and the School item retains `task_created=true` as tombstone
  evidence.
- Disappearance from a successful snapshot sets `missing_since`; it never deletes
  or completes the School item or Task.

## Modes and audit

`integration_accounts.blackboard_sync_mode` is one of:

- `off`: no fetch or reconciliation is permitted. This is the migration default.
- `observe`: source observations and audit outcomes are stored, but School and
  Tasks are not mutated.
- `apply`: deterministic supported changes may be applied to canonical School and
  Tasks. Only a request authenticated with the Supabase service-role credential
  can activate this value or call reconciliation.

Each run records its mode, completion state, counts, and bounded error code.
Each observation records an outcome, reason, source-change flag, canonical IDs
when resolved, and the mutation that observe mode withheld. Values are bounded;
the audit does not store the private feed credential.

## Redacted characterization

The integration screen offers **Inspect redacted structure** after a feed has
been connected in observe mode. The report includes only structural evidence:
field presence, lengths and types, parameter names, timezone labels, category
value shapes, URL hostname/path shape/query-key names, description label names,
X-property names, UID pattern, and a structural hash. It excludes raw UID,
summary, description, location, path/query values, source IDs, and the private
subscription URL.

For each live acceptance session, inspect at least: repeated snapshots, one new
assignment, one deadline change, all-day and timed deadlines, course identifiers,
object identifiers, `SEQUENCE`/`LAST-MODIFIED`, recurrence/cancellation behavior,
and disappearance/return. If a new structural pattern must become parser input,
add a hand-sanitized fixture that preserves only that actually observed structure
and rerun all S1/S2 tests before promoting it. Never commit or paste the raw feed.

## Deployment and activation

1. Complete S1 live acceptance first: a real assignment creates one linked Task,
   a deadline-change email updates that same Task, replay is idempotent, and the
   School UI shows correct mapped and unresolved states.
2. Deploy migration `20260910100000_blackboard_calendar_s2.sql` with the existing
   migration chain.
3. Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `INTEGRATION_CREDENTIAL_ENCRYPTION_KEY`, `APP_TIME_ZONE`, and the exact
   Blackboard hostname in `SCHOOL_BLACKBOARD_HOSTS`. Wildcards are not supported.
4. Connect the private feed at `/integrations/blackboard`. Configuration validates
   one complete secure read before encrypting the URL and sets mode to observe.
5. Run the redacted characterization and repeated manual observe syncs. Compare
   `sync_changes.details.proposedMutation` to canonical School/Task state. Resolve
   mappings explicitly; do not infer them from similar titles.
6. Exercise the ordering and failure matrix against non-production/shadow data,
   including malformed/oversized input, timeout/partial response, stale calendar
   after email, duplicate UID, multiple observations for one School item,
   conflicting strong identities, ambiguous courses, deleted Task, and failed
   snapshot absence handling.
7. After a reviewed live characterization fixture and S1 acceptance evidence
   pass, an operator may use a one-off trusted service-role client to set the
   account to `apply`. The browser session and product UI cannot perform this
   transition. Re-run manually and inspect audit results before considering a
   scheduler in any later assignment.

Apply activation and a production schedule are operational decisions, not part of
this implementation. Do not enable either merely because the migration deployed.
