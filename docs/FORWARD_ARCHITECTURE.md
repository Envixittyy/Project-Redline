# Forward Architecture & Design System

Forward (internal project codename: Project Redline) is a private, single-user personal command center and academic operating system. The user-facing product name is **Forward** and the guiding philosophy is **“Be curious, not judgmental.”**

The fundamental operational loop is:

> Capture fast → organize automatically → show what matters → reduce decisions → keep automation reversible.

This document defines the authoritative architectural contracts, visual design foundations, data boundaries, and security triggers for all future phases. Phase-by-phase implementation sequencing is maintained in `docs/ROADMAP.md`.

---

## 1. Core Architectural Boundaries

- **Single-User Architecture:** Built exclusively for one person. Do not introduce multi-tenant isolation, organizations, team sharing, SaaS billing, or generic workflow engine abstractions.
- **Server-First Composition:** Next.js App Router pages default to Server Components. Small client boundaries (`"use client"`) are introduced only where browser interaction, local device state, or Web APIs require them.
- **Strict Domain Separation:**
  - `src/components/ui` owns domain-neutral visual and layout primitives.
  - `src/components/shell` owns application frame, navigation, and global trigger composition.
  - `src/features/<feature>` owns feature-specific UI, forms, and pure domain logic.
  - `src/services/<domain>` owns data persistence and repositories. Repositories authenticate every call via `src/services/supabase/request.ts`.
  - `src/services/integrations/<provider>` contains external-provider adapters, crypto boundaries, and format translation.
- **Untrusted Input Boundaries:** Model outputs, browser payloads, Server Action inputs, and external webhooks/feeds are untrusted and must be validated before domain consumption.
- **Security & RLS:** Supabase Row Level Security (RLS) is the security boundary. Application-level user ID filters are defense in depth.
- **Distinct Persistence Entities:** Tasks, task work sessions, native calendar events, external calendar mirrors, and Blackboard records remain strictly distinct persistence domains even when presented together on unified views.

---

## 2. Visual Identity & Liquid-Glass Design Direction

### Visual Atmosphere & Palette
Forward uses a **deep, dimensional blue visual identity**. The default dark aesthetic is dark, cool, and layered (slightly darker than modern streaming/cinematic interfaces):
- **Background (Level 0):** Very dark navy / blue-black (`oklch(13.5% 0.025 255)`).
- **Elevated Background (Level 1):** Dark navy-blue (`oklch(16.5% 0.028 255)`).
- **Primary Surfaces (Level 2):** Subtle translucent navy (`oklch(19.5% 0.03 255 / 76%)`) with backdrop blur.
- **Highlights & Accents:** Restrained electric/cobalt blue (`oklch(61% 0.225 255)`) for focus, active indicators, and selection.
- **Typography:** High-contrast cool white / soft white primary text (`oklch(96% 0.012 255)`), cool desaturated blue-gray secondary text (`oklch(74% 0.025 255)`), and muted tertiary text (`oklch(60% 0.025 255)`).
- **Semantic Statuses:** Success (emerald green), Warning (warm amber), Info (sky blue), Destructive/Error (crimson red). Destructive red is strictly reserved for errors and irreversible actions to maintain a calming, low-anxiety workspace.

### Liquid-Glass Primitives
Inspired by Apple's liquid-glass design language, Forward applies layered translucency to create visual hierarchy rather than making all elements uniformly transparent:
- **Translucent Glass:** Applied to floating navigation bars, modal dialog shells, command palettes, dropdown menus, and interactive overlays.
- **Solid / Opaque Surfaces:** Applied to content-dense writing surfaces (Markdown editor) and long task lists to guarantee high contrast and eliminate eye strain.
- **Glass Characteristics:** Layered backdrop blur (`18px – 24px`), subtle surface reflections, thin illuminated upper edge borders (`oklch(90% 0.025 255 / 12%)`), faint inner shadows, and soft ambient drop shadows.

### Depth Hierarchy
The interface is structured into six discrete depth planes:
- **Level 0 (Ambient Canvas):** Application viewport with subtle radial ambient gradients and soft blurred blue light sources.
- **Level 1 (Content Surfaces):** Main scrollable layout frames and dashboard backdrops.
- **Level 2 (Cards & Widgets):** Task rows, calendar containers, note list items, and dashboard cards.
- **Level 3 (Interactive Floating Controls):** Floating quick-action buttons, active tab indicators, and search triggers.
- **Level 4 (Popovers & Tooltips):** Dropdown selectors, date pickers, and context menus.
- **Level 5 (Modals & Command Surfaces):** Command palette (`Ctrl+K`), Universal Capture overlay (`Ctrl+Shift+Space`), task editor modal, and notification drawer.

### Motion System & Microinteractions
Motion in Forward is smooth, responsive, physically coherent, and spring-like:
- **Composited Primitives:** Motion uses GPU-composited `transform`, `opacity`, and CSS `filter`. Indiscriminate layout animation (`width`, `height`, `margin`) is prohibited.
- **Spring Curve:** Uses `--motion-spring` (`linear(0, 0.006, 0.025 2.8%, ... 1)`) for natural settles and `--motion-fast` (`140ms`) for crisp interaction feedback.
- **Microinteractions:** Button press compression (`scale(0.985)`), subtle card lift on hover, smooth checkbox completion morphing, and surface edge illumination on focus.
- **Accessibility & Reduced Motion:** `prefers-reduced-motion` and `data-motion="reduced"` clamp durations to instant/minimal transitions (`1ms – 80ms`) with zero spatial displacement.

### Performance & Mobile Accessibility
- Avoid excessive simultaneous `backdrop-filter` nodes on mobile viewports.
- Mobile iPhone Safari and standalone PWA support touch targets (minimum 44x44px), bottom safe-area insets (`env(safe-area-inset-bottom)`), and responsive floating bottom navigation.

---

## 3. Universal Capture & Reversible Operations

`src/features/capture/capture-domain.ts` and `src/features/operations/operation-domain.ts` govern capture lifecycle:

```text
CAPTURE → INTERPRET → PROPOSE → CONFIRM → COMMIT → UNDO
```

1. **Capture:** Raw input is stored immutably in `captures` table (text, pasted text, link, and future image/screenshot uploads).
2. **Interpret:** Deterministic parser extracts task title, due dates, and priority without requiring AI.
3. **Propose & Confirm:** User reviews editable proposal card before any database entity is created.
4. **Commit:** Single database transaction creates the Inbox task and records an operation batch.
5. **Undo:** Idempotent 10-minute undo window via server-authored inverse actions; refuses deletion if the task was modified or gained subtasks after creation.

---

## 4. Calendar, Tasks & Multi-Source Scheduling

### Multi-Source Projections
`src/features/calendar/calendar-source-contract.ts` defines five distinct calendar projections:
1. **Task Deadlines:** Due date / timed deadline markers. Clicking opens the task editor.
2. **Task Work Sessions:** Dedicated planned work blocks from `task_work_sessions`. A task may own multiple work sessions.
3. **Forward Native Events:** User-created calendar events (`source = 'life_os'`) with start/end instants.
4. **External Calendar Mirrors:** Read-only mirrored events from Google Calendar and future CalDAV providers.
5. **School Timetable Meetings:** Dynamic recurring class occurrences projected at read-time from `course_meetings`.

### Tasks are NOT Calendar Events
A task may carry a deadline, scheduled start/end, and multiple work sessions without becoming a `calendar_events` row. Dragging or rescheduling a task on the calendar updates task/session timestamps; it never creates or mutates calendar event records.

---

## 5. Deterministic Planning & Scheduling Engine (P8)

`src/features/planning/scheduler-contract.ts` defines the mathematical planning engine:
- **Inputs:** Fixed calendar commitments, protected time blocks, preferred work windows, task deadlines, estimated durations, priorities, earliest start times, splittability, break buffers, and minimum session lengths.
- **Engine Rules:** The core scheduler is 100% deterministic, testable, and pure. It operates without database or LLM dependencies, calculating optimal non-overlapping work sessions in available free-time slots.
- **UX Integration:** Powers "Plan My Day" and "What Should I Do Now?" interfaces. Proposals are presented for one-click user review before persisting to `task_work_sessions`.

---

## 6. Focus & Goldfish Mode (P9)

Goldfish Mode is an explicitly activated, reversible presentation filter:
- **Purpose:** Eliminates cognitive overload and backlog anxiety by isolating today's immediate commitments, hard deadlines, and current/next work session.
- **Zero Guilt Design:** Hides backlog counters, overdue warnings, and non-essential clutter.
- **Pure Presentation:** Filters data at the UI layer without altering, postponing, or deleting underlying task/calendar records.

---

## 7. School & Blackboard Ingestion Flow

### Blackboard Data Flow
To protect data integrity, Blackboard sync **never silently creates native application tasks**:

```text
External Blackboard Feed / Item
        ↓
Source-Aware `external_records`
        ↓
Universal Capture Proposal
        ↓
User Review & Confirmation
        ↓
Native Redline Task (Created only upon explicit confirmation)
```

- **iCal Calendar Feed:** Encrypted AES-256-GCM storage, strict DNS pinning, public IP verification, redirect re-validation, and defensive iCal parsing.
- **Announcements & Content:** The unused `announcements` table is technical debt. Any future authenticated school content ingestion must not rely on brittle scraping.

---

## 8. Notion Knowledge Integration (P5)

`src/services/integrations/notion/provider-contract.ts` defines the staged integration:
- **Stage 1 (Outbound Export):** Export Forward Markdown notes to Notion pages with encrypted integration tokens, persisting `remotePageId`, `remoteUrl`, and SHA-256 content fingerprints.
- **Stage 2 (Update Sync):** Sync local Markdown updates to existing remote Notion pages.
- **Stage 3 (Selective Two-Way Sync):** Ingest remote Notion page updates with loop suppression and conflict detection. Forward remains the authoritative operational master.

---

## 9. Local AI Companion & Cloud Privacy

### Local Companion Architecture (Transport & Security Undecided)
- **Product Requirement:** Local Companion support is a confirmed future requirement to leverage local models (Local Qwen, OpenAI-compatible local endpoints, and optional Ollama / LM Studio compatibility) when the user's computer is available.
- **Zero Cloud Dependence:** Redline is cloud-hosted and MUST continue functioning completely normally when the companion is offline, disconnected, or unavailable.
- **Security Invariants:** Secure pairing, key revocation, origin validation, and explicit permission boundaries remain mandatory requirements.
- **Transport Mechanism Undecided:** The specific transport architecture (e.g. browser loopback, WebSocket, WebRTC, relay server, localhost bridge, browser extension, or companion tunnel) is intentionally UNDECIDED and uncommitted at this stage.
- **Explicit Review Gate:** *Local Companion transport and security architecture requires Codex architectural review before implementation.*
- **Vision Worker Memory Policy:** On-demand wake, 60–180s idle timeout, and automatic memory unload on system pressure.

### Cloud AI Privacy Gate
- **Cloud Fallback Modes:** `off`, `ask_each_time` (default), `automatic_on_low_confidence`.
- **Explicit Privacy Gate:** Private tasks, notes, or uploaded screenshots/images are NEVER transferred to cloud LLMs without explicit, interactive user consent.

---

## 10. Notifications Architecture

- **In-App Notification Center:** Shell tray displaying unread/read state, timestamped alerts, and safe deep links.
- **Delivery Channels:** Web Push (VAPID) for desktop browsers and installed standalone iOS PWA.
- **Deduplication & Safety:** Deterministic dedupe keys (`${type}:${sourceId}:${revision}`), URL sanitization (`safeDeepLink`), and quiet hours suppression (`isQuietHours`).

---

## 11. Security Review Triggers (Codex Escalation)

Codex review is mandatory before merging changes to:
1. **Authentication, RLS & Session Boundaries:** Supabase Auth, SSR cookie refresh, or table RLS policies.
2. **Database Migrations & Triggers:** New tables, foreign key constraints, or owner backfill RPCs.
3. **SSRF & Network Fetch Defenses:** `safe-fetch.ts`, DNS pinning, IP classification, or OAuth redirect handlers.
4. **Cryptographic Storage & Keys:** AES-256-GCM credential envelopes and token encryption.
5. **Local Companion Transport & Security Architecture:** Transport protocol, pairing token exchanges, origin verification, and cloud data transfer consent gates.
6. **Two-Way Synchronization & Recurrence Semantics:** Notion two-way sync loop suppression, Google Calendar writeback, or recurring task data models.
