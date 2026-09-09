# Phase S1 dependency record

No third-party application source was copied. Package licenses remain distributed
with their installed packages. This record covers the substantial S1 additions
and existing components reused for this implementation.

| Component | Version | License | Source and purpose | Selection |
| --- | --- | --- | --- | --- |
| html-to-text | 10.0.1 | MIT | https://github.com/html-to-text/node-html-to-text — HTML DOM conversion, entity decoding, text/link extraction | Maintained Node converter with bounded traversal; avoids a custom HTML parser. Node >=20.19 is required. |
| node-ical | 0.27.1 | Apache-2.0 | https://github.com/jens-maus/node-ical — RFC 5545 parsing from already-fetched calendar text | Maintained Node 22+ parser with bundled TypeScript declarations, timezone metadata, and recurrence support. Its URL/file fetch helpers are not used; Redline retains DNS pinning, redirect, timeout, and response-size controls. |
| @types/html-to-text | 9.0.4 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/html-to-text — converter declarations | Maintained typings; used APIs validated by typecheck and runtime fixtures. |
| Zod | 4.4.3 | MIT | https://github.com/colinhacks/zod — webhook shape and input validation | Already present transitively; declared directly without upgrading it. |
| Supabase JS / SSR | Existing lockfile versions | MIT | https://github.com/supabase/supabase-js and https://github.com/supabase/ssr — existing authenticated and maintenance clients | Reuses Redline's database and auth boundaries. |
| PGlite | 0.5.8 | Apache-2.0 | https://github.com/electric-sql/pglite — execute actual PostgreSQL migrations and transactions in tests | Already installed and used by the repository. |
| Vitest | 4.1.11 | MIT | https://github.com/vitest-dev/vitest — test runner | Existing repository standard. |

Postmark is an external hosted service, not copied open-source code or an added
SDK dependency. Its inbound API supplies decoded MIME parts and address fields;
Redline therefore does not implement multipart, quoted-printable, attachment or
RFC address parsers. The adapter uses Postmark's documented Basic-over-HTTPS
authentication. Native Node crypto supplies hashing and constant-time comparison;
existing Redline date helpers supply timezone conversion.

Provider comparison: Postmark sends parsed body/header fields in one webhook;
Resend's receiving webhook requires a second API retrieval for body content.
Postmark was selected to avoid an additional outbound request/API credential.
Sources checked: https://postmarkapp.com/developer/webhooks/inbound-webhook,
https://postmarkapp.com/developer/webhooks/webhooks-overview,
https://resend.com/docs/knowledge-base/how-can-i-receive-emails-with-resend.
