"use client";

import {
  Bell,
  BookOpen,
  CalendarDays,
  CalendarSync,
  Clock,
  Compass,
  Ellipsis,
  Film,
  GraduationCap,
  House,
  Inbox,
  ListTodo,
  Lock,
  NotebookPen,
  Plane,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  Users,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  matchHiddenCommand,
  type HiddenCommandKind,
} from "@/features/personality/hidden-commands";
import {
  HowCookedAmIModal,
  LosSantosModal,
  TelemetryModal,
} from "@/features/personality/telemetry-modal";
import { AboutRedlineModal } from "@/features/personality/about-redline-modal";

import styles from "./command-palette.module.css";

const openPaletteEvent = "forward:open-command-palette";

type Command = {
  description: string;
  href: string;
  icon: LucideIcon;
  keywords: string;
  label: string;
};

const commands: readonly Command[] = [
  {
    label: "Lock In mofo",
    description: "Distraction-free execution right now",
    href: "/focus",
    icon: Zap,
    keywords: "focus goldfish mode now today lock in distraction free timer",
  },
  {
    label: "Plan My Day",
    description: "Review schedule suggestions for today",
    href: "/#planning",
    icon: Compass,
    keywords:
      "plan my day schedule optimizer recommendations work sessions focus",
  },
  {
    label: "What Should I Do Now?",
    description: "Check recommendation for your current focus",
    href: "/#planning",
    icon: Sparkles,
    keywords: "what should i do now focus next recommendation active task",
  },
  {
    label: "So, Ano Na?",
    description: "Return to today’s overview",
    href: "/",
    icon: House,
    keywords: "dashboard overview today home ano na",
  },
  {
    label: "Unsorted Bullshit",
    description: "Review raw captures and proposals",
    href: "/inbox",
    icon: Inbox,
    keywords: "capture raw input review proposal inbox unsorted bullshit",
  },
  {
    label: "Shit to Do",
    description: "Open all tasks and priorities",
    href: "/tasks",
    icon: ListTodo,
    keywords: "todo work inbox tasks shit to do",
  },
  {
    label: "Today’s Shit to Do",
    description: "See what is due or scheduled today",
    href: "/tasks?view=today",
    icon: ListTodo,
    keywords: "now due schedule today tasks",
  },
  {
    label: "My Alleged Schedule",
    description: "Open the calendar workspace",
    href: "/calendar",
    icon: CalendarDays,
    keywords: "events month week agenda calendar schedule",
  },
  {
    label: "Calendar connections",
    description: "Review external providers and capabilities",
    href: "/integrations/calendars",
    icon: CalendarSync,
    keywords: "google microsoft outlook icloud caldav ics sync",
  },
  {
    label: "Academic Suffering",
    description: "Review courses and meetings",
    href: "/school",
    icon: GraduationCap,
    keywords: "classes courses timetable school academic suffering",
  },
  {
    label: "Notes",
    description: "Open private notes",
    href: "/notes",
    icon: NotebookPen,
    keywords: "markdown writing attachments notes",
  },
  {
    label: "Appearance",
    description: "Adjust mode and accent on this device",
    href: "/more#appearance",
    icon: Settings2,
    keywords: "theme dark light color settings appearance",
  },
  {
    label: "Blackboard",
    description: "Review secure School email ingestion",
    href: "/integrations/blackboard",
    icon: ShieldCheck,
    keywords: "school integration email postmark outlook blackboard",
  },
  {
    label: "Notification Preferences",
    description: "Manage in-app categories, quiet hours, and push alerts",
    href: "/settings/notifications",
    icon: Bell,
    keywords: "notifications alerts preferences quiet hours push bell",
  },
  {
    label: "Anti-Gastador",
    description: "Financial responsibility WIP area",
    href: "/anti-gastador",
    icon: Wallet,
    keywords: "anti gastador finance money wallet expenses planned wip",
  },
  {
    label: "Soon™",
    description: "Gaming backlog and tracking WIP area",
    href: "/soon",
    icon: Clock,
    keywords: "soon games gaming playtime steam launcher planned wip",
  },
  {
    label: "Things to Consume Before I Die",
    description: "Media backlog and watchlist WIP area",
    href: "/consume",
    icon: Film,
    keywords: "consume media movies books shows music podcasts planned wip",
  },
  {
    label: "Dear Dumbass",
    description: "Personal journal and moments WIP area",
    href: "/dear-dumbass",
    icon: BookOpen,
    keywords: "dear dumbass journal thoughts memories personal planned wip",
  },
  {
    label: "Lore",
    description: "Personal timeline and canon events WIP area",
    href: "/lore",
    icon: Compass,
    keywords: "lore timeline memories history canon incident planned wip",
  },
  {
    label: "These Mfs",
    description: "People, birthdays, and connections WIP area",
    href: "/people",
    icon: Users,
    keywords: "these mfs people friends family birthdays contacts planned wip",
  },
  {
    label: "Gala",
    description: "Trips, places, and travel plans WIP area",
    href: "/gala",
    icon: Plane,
    keywords: "gala trips travel places itinerary destinations planned wip",
  },
  {
    label: "Football (EFU)",
    description: "Club organization and training WIP area",
    href: "/football",
    icon: Trophy,
    keywords: "football efu training matches club soccer planned wip",
  },
  {
    label: "Skills",
    description: "Learning map and milestones WIP area",
    href: "/skills",
    icon: Target,
    keywords: "skills learning progress practice milestones planned wip",
  },
  {
    label: "None of Your Business",
    description: "Local private vault WIP area",
    href: "/private",
    icon: Lock,
    keywords: "none of your business private vault local history secret planned wip",
  },
  {
    label: "More",
    description: "Access secondary areas, WIP features, and preferences",
    href: "/more",
    icon: Ellipsis,
    keywords: "more settings integrations account appearance preferences",
  },
] as const;

export function CommandPaletteTrigger({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className={compact ? styles.compactTrigger : styles.trigger}
      aria-label={compact ? "Open command palette" : undefined}
      onClick={() => window.dispatchEvent(new Event(openPaletteEvent))}
    >
      <Search size={compact ? 19 : 17} aria-hidden="true" />
      {compact ? null : <span>Quick find</span>}
      {compact ? null : <kbd>Ctrl K</kbd>}
    </button>
  );
}

export function CommandPalette() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeModal, setActiveModal] = useState<HiddenCommandKind | null>(
    null,
  );

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands;

    return commands.filter((command) =>
      `${command.label} ${command.description} ${command.keywords}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [query]);

  useEffect(() => {
    function openPalette() {
      if (activeModal) return;
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setQuery("");
      setActiveIndex(0);
      setOpen(true);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
      }
    }

    window.addEventListener(openPaletteEvent, openPalette);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener(openPaletteEvent, openPalette);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeModal]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() =>
      inputRef.current?.focus(),
    );

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function closePalette({ restoreFocus = true } = {}) {
    setOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    }
  }

  function choose(command: Command) {
    closePalette({ restoreFocus: false });
    router.push(command.href);
  }

  function triggerHiddenCommand(hidden: HiddenCommandKind) {
    closePalette({ restoreFocus: false });
    setActiveModal(hidden);
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
      return;
    }

    if (event.key === "ArrowDown" && filteredCommands.length) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % filteredCommands.length);
      return;
    }

    if (event.key === "ArrowUp" && filteredCommands.length) {
      event.preventDefault();
      setActiveIndex(
        (current) =>
          (current - 1 + filteredCommands.length) % filteredCommands.length,
      );
      return;
    }

    if (event.key === "Enter") {
      const hidden = matchHiddenCommand(query);
      if (hidden) {
        event.preventDefault();
        triggerHiddenCommand(hidden);
        return;
      }

      if (filteredCommands[activeIndex]) {
        event.preventDefault();
        choose(filteredCommands[activeIndex]);
        return;
      }
    }

    if (event.key === "Tab" && panelRef.current) {
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled])",
        ),
      );
      const first = focusable.at(0);
      const last = focusable.at(-1);

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  return (
    <>
      {activeModal === "telemetry" ? (
        <TelemetryModal
          onClose={() => {
            setActiveModal(null);
            window.requestAnimationFrame(() => returnFocusRef.current?.focus());
          }}
        />
      ) : null}
      {activeModal === "how_cooked_am_i" ? (
        <HowCookedAmIModal
          onClose={() => {
            setActiveModal(null);
            window.requestAnimationFrame(() => returnFocusRef.current?.focus());
          }}
        />
      ) : null}
      {activeModal === "los_santos" ? (
        <LosSantosModal
          onClose={() => {
            setActiveModal(null);
            window.requestAnimationFrame(() => returnFocusRef.current?.focus());
          }}
        />
      ) : null}
      {activeModal === "about_redline" ? (
        <AboutRedlineModal
          onClose={() => {
            setActiveModal(null);
            window.requestAnimationFrame(() => returnFocusRef.current?.focus());
          }}
        />
      ) : null}

      {open ? (
        <div
          className={styles.backdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePalette();
          }}
        >
          <div
            ref={panelRef}
            className={`${styles.panel} motion-modal-enter`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="command-palette-title"
            onKeyDown={handlePanelKeyDown}
          >
            <div className={styles.heading}>
              <div>
                <p>Adulting.exe</p>
                <h2 id="command-palette-title">Where do you want to go?</h2>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                aria-label="Close command palette"
                onClick={() => closePalette()}
              >
                <X size={19} aria-hidden="true" />
              </button>
            </div>

            <label className={styles.searchField}>
              <Search size={19} aria-hidden="true" />
              <span className={styles.srOnly}>Search commands</span>
              <input
                ref={inputRef}
                value={query}
                role="combobox"
                aria-autocomplete="list"
                aria-controls="command-results"
                aria-expanded="true"
                aria-activedescendant={
                  filteredCommands[activeIndex]
                    ? `command-${activeIndex}`
                    : undefined
                }
                placeholder="Search Adulting.exe…"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
              />
              <kbd>Esc</kbd>
            </label>

            <div
              id="command-results"
              className={styles.results}
              role="listbox"
              aria-label="Commands"
            >
              {filteredCommands.length ? (
                filteredCommands.map((command, index) => {
                  const Icon = command.icon;
                  const active = index === activeIndex;
                  return (
                    <button
                      type="button"
                      id={`command-${index}`}
                      key={command.label}
                      className={`${styles.command} motion-interactive`}
                      role="option"
                      aria-selected={active}
                      data-active={active || undefined}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(command)}
                    >
                      <span className={styles.commandIcon} aria-hidden="true">
                        <Icon size={18} />
                      </span>
                      <span>
                        <strong>{command.label}</strong>
                        <small>{command.description}</small>
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className={styles.empty}>
                  <Search size={20} aria-hidden="true" />
                  <p>No match yet. Try a page name like Tasks or Calendar.</p>
                </div>
              )}
            </div>

            <p className={styles.hint}>
              <span>↑↓ move</span>
              <span>↵ open</span>
              <span>Esc close</span>
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
