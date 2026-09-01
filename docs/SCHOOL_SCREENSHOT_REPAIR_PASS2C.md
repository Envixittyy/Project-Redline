# School Intelligence Repair — Pass 2C

## Scope

Pass 2C activates exactly two School product adapters:

- `schoolScheduleImage.propose`: a selected screenshot proposes canonical Courses and additive Course Meetings.
- `blackboardCourseImage.propose`: a selected visible Blackboard Course list proposes canonical Courses only.

Academic Calendar, Universal Capture image/OCR, Notes AI, Quick Capture AI, Daily Plan AI, Course Material AI, Contextual Assistant, prediction conversion, and PDF/DOCX remain disabled.

## Authority chain

Both adapters compose the existing systems rather than creating parallel trust stores:

1. Pass 2A validates and normalizes one selected image to PNG.
2. One five-minute disclosure binds exact bytes, digest, owner, capability, provider, model, modality source, location, and consent state.
3. One Pass-1 version-2 scoped request fingerprints that validated image and binds the disclosure metadata.
4. Provider output is parsed as untrusted extraction only.
5. The initial exact persisted review marks every row `IGNORE`.
6. User edits are sent to a narrow successor RPC. The database validates the draft and seals current fingerprints for exact `MATCH_EXISTING` Course IDs.
7. Apply accepts only a batch ID, locks the request/source/review/policy/targets, executes fixed SQL, records audit evidence, consumes the review, and commits atomically.

Local and remote-local image calls require a Companion ticket over the exact normalized-image request body. Cloud calls require an exact configured vision model, capability-specific opt-in, and a fresh Send-once confirmation. There is no automatic image fallback.

## Schedule semantics

The provider may return only visible Course code/name and bounded meetings containing a lowercase weekday, strict `HH:mm` start, optional strict end, and optional room. Missing facts remain absent. A selected create/match row must have a valid end time before sealing.

The reviewed target is one of `MATCH_EXISTING`, `CREATE_NEW`, or `IGNORE`. Existing targets use the exact reviewed UUID and a server-generated Course/meeting fingerprint. Apply never fuzzy-matches or substitutes a current Course. A stale, archived, deleted, or changed target fails.

Meeting identity is Course + weekday + start + end + time zone. Room is presentation metadata and is excluded from identity, preventing a changed room label from duplicating the same slot. Imports only add missing meetings. They never delete, replace, or synchronize away manual meetings. A changed time/day is treated as a distinct reviewed addition because this pass has no divergence/baseline model.

## Blackboard semantics

Provider output permits only a visible label and optional visible code/title. IDs, external identities, mapping identities, URLs, terms, sections, and provider authority are rejected. The screenshot can create or match canonical Courses but cannot establish Blackboard identity.

The fixed consumer never writes `blackboard_course_mappings`. Existing deterministic Blackboard integration mappings remain authoritative and unresolved screenshot rows stay unresolved. `CREATE_NEW` rejects normalized Course-code collisions such as `CPE201` and `CPE 201`; ambiguity must be resolved with an exact reviewed match.

## Limits and known behavior

Schedule output is limited to 12 Courses and seven meetings per Course. Blackboard output is limited to 20 rows. Strings and total JSON are bounded. Unsupported domain fields such as section and delivery type are omitted because current canonical Course/Course Meeting schemas do not store them.

Validated image bytes and execution authority expire after five minutes. This pass does not add destructive schedule synchronization, retained import baselines, live provider tests, physical-device tests, or a production migration run.
