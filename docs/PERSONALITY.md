# Project Redline — Authoritative Product Personality & Design Guide

Last updated: August 2026.
Authoritative source of truth for the Project Redline (Forward) personality layer, microcopy rules, motion principles, and easter egg conventions.

---

## 1. Product Personality

Project Redline is a **private, single-user personal command center and life management system**. It is an intentionally overbuilt personal passion project crafted for one person (Kyle).

### What Redline Is NOT:
- A generic SaaS product with hollow corporate cheer.
- An enterprise team dashboard with multi-tenant jargon.
- A fandom-themed skin or cosplay interface.
- A video game UI clone with loud neons and faux-sci-fi chrome.
- A noisy, self-indulgent app full of in-your-face jokes on every screen.

### What Redline IS:
- **SMART & ENGINEERED:** Deep, clean technical precision. Information is structured and purposeful.
- **PRIVATE & PERSONAL:** Built for one life on one planet. Single-user assumptions are embraced.
- **DRY & SELF-AWARE:** Deadpan wit, subtle software self-awareness, occasional dry acknowledgment of reality.
- **OCCASIONALLY SINCERE:** Capable of genuine perspective and calm human warmth when dealing with sensitive or meaningful life contexts.
- **SUBTLE:** Personality **rewards recognition**; it **does NOT demand attention**.

### The 85/15 Rule:
- **85–90%** normal, highly polished, friction-free productivity application.
- **10–15%** subtle personality, dry microcopy, and earned moments.

---

## 2. Voice & Microcopy Rules

### Tone & Vocabulary:
- Use engineering-adjacent terminology where it makes semantic sense:
  - `status`, `telemetry`, `nominal`, `load`, `runtime`, `signal`, `sync`, `headroom`, `latency`.
- Never pretend simple task lists are rocket trajectories or Formula 1 race telemetry. Use engineering words only where they genuinely communicate status or workload cleanly.

### Canonical Redline Voice Examples:
- *"Classes, deadlines, notes, unfinished business, and whatever else has made its way into the system."*
- *"Here's where things stand."*
- *"Nothing catastrophic."*
- *"System load looks reasonable."*
- *"Future Kyle would probably appreciate this."*
- *"Nothing here. Suspiciously peaceful."*
- *"If it's in here, I'll find it."*
- *"Well, shit. That didn't work."* (Rare, authentic failure acknowledgment).

### When NOT to Use Jokes (Softer Areas):
- **Sensitive Personal Data & Wellness:** No sarcasm, no cynicism, no aggressive productivity metrics. Use calm perspective influenced by *Ted Lasso* and *Shrinking*:
  - *"A few things slipped. Worth noticing, not overreacting to."*
  - *"You don't need to optimize every part of being a person."*
- **Critical / Irreversible Errors:** Clear, non-snarky explanation of what failed and how to proceed safely.
- **Destructive Confirmations:** Explicit, sober confirmation prompts.

### Humor Limits:
- Deadpan, sarcastic, nerdy, self-aware.
- **No constant profanity:** Rare, earned mild swearing (e.g., *"Well, shit. The model wandered off."*) is acceptable because this is a private personal app, but must never be gratuitous.
- **No forced memes or internet slang.**
- **No insults directed at the user.**

---

## 3. Personality Sources & Subtle Inspiration

The following personal interests inform Redline's subtle atmosphere. They provide inspiration for themes, interaction physics, engineering values, and hidden references—**never copied copyright assets or obvious fan branding**.

| Domain | Influences | How It Shows Up in Redline |
| :--- | :--- | :--- |
| **Games** | *Red Dead Redemption 2*, *The Witcher 3*, *Cyberpunk 2077*, *Spider-Man*, *God of War*, *GTA V*, *Detroit: Become Human*, *Jedi: Fallen Order/Survivor* | Physical weight, responsive motion, deliberate destructive confirmations, branching decision clarity. |
| **TV / Film** | *Ted Lasso*, *Shrinking*, *Christopher Nolan*, *Project Hail Mary*, *Star Wars* | Perspective, empathy in low-pressure moments, structural precision, grounded optimism. |
| **Sport** | Lewis Hamilton, Lionel Messi, Ferrari, LeBron James, Lamine Yamal | Subtle numbers (`44`, `10`, `23`), quiet excellence under pressure, relentless precision. |
| **Tech & Displays** | GPUs, HDR, near-black OLED contrast, high bitrate, telemetry | Deep dimensional blues, zero clipped whites, disciplined dark mode, crisp typography. |
| **Cars** | Porsche 911 GT3 RS, Supra Mk4, Nissan GT-R, old-school JDM | Mechanical snap, tactile weight, tachometer-inspired telemetry status lines. |
| **Space** | Cosmic perspective, planetary rarity, cosmic scale | Sincere philosophical foundation: *"A private system for keeping track of one life on one very small planet."* |

---

## 4. Copyright & Reference Boundary

1. **NEVER COPY:** Movie dialogue, TV scripts, song lyrics, game voice lines, sports commentary audio, or copyrighted artwork/logos.
2. **USE INSTEAD:** Original writing, mechanical themes, obscure numbers, interaction physics, and structural ideas.

---

## 5. Interaction Weight & Motion Principles

### Tactile Feedback:
- **Task Completion:** Subtle tactile compression (`scale(0.985)`), checkbox snaps crisply into state with spring settle (`--motion-spring`), card transitions smoothly. No confetti, no celebration sound effects.
- **Destructive Actions:** Deliberate confirmation states with weighted button press feedback.
- **Responsiveness:** Fast 60/120Hz feel (`140ms` interactive response, `220ms` standard transition). Animations must never delay user actions.

### Accessibility:
- Strictly honor `prefers-reduced-motion` and `data-motion="reduced"` by clamping durations and removing spatial transforms.

---

## 6. Display & Contrast Sensibility

- Dark mode is the primary visual presentation (`tokens.css`).
- Backgrounds use deep, dimensional navy-black (`oklch(15.5% 0.025 255)`).
- Never render pure harsh `#ffffff` on large flat panels; use soft, high-contrast cool white typography (`oklch(95.5% 0.012 255)`).
- Liquid-glass surfaces use layered backdrop blur (`18px–24px`) with thin, illuminated top borders (`border-top: 1px solid var(--border)`).

---

## 7. Hidden Easter Egg System

Easter eggs are structured into three distinct tiers:

### LEVEL 1: Ambient Personality (Everyday)
- Time-aware personal greetings on Home.
- Deterministic system load telemetry (`SYSTEM LOAD: NOMINAL`).
- Dry, original empty and loading state microcopy.

### LEVEL 2: Recognizable Cultural References
- Hidden triggers or subtle microcopy that another person with similar taste might catch, phrased originally.

### LEVEL 3: Personal User References (Kyle-Specific)
- Obscure numbers (`44`, `10`), personal build metadata, deep space perspective statements.

### Command Palette Hidden Triggers:
Hidden commands are omitted from standard search autocomplete. They activate only on exact phrase matches:
- `telemetry` / `44`: Opens a workload snapshot and diagnostics overlay: actual database read result, task/class counts, explicitly unchecked sync health, and a user-triggered local companion reachability check. Never substitute hardcoded healthy states or fabricated counts.
- `how cooked am i`: Produces a deterministic workload assessment based on active tasks, deadlines, and classes.
- `los santos`: Displays a subtle dismissible dialog (*"Los Santos: questionable decisions remain statistically likely."*).
- `redline`: Displays the About Redline personal build card and philosophy.

---

## 8. Guidance for Future Agents

Before creating or editing UI components, empty states, error handlers, or copy in Project Redline:
1. Verify that copy adheres to the 85/15 rule.
2. Do not insert jokes into irreversible operations, wellness, or authentication flows.
3. Keep microcopy dry, concise, and authentic.
