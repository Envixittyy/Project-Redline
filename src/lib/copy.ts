/**
 * Adulting.exe Centralized Copy & Voice Dictionary
 *
 * Voice balance target across the app:
 * - 60–65% straightforward useful language
 * - 25–30% conversational / mildly chaotic
 * - 8–12% genuinely chaotic or unhinged
 * - 1–2% absurd personality-malfunction Easter eggs
 *
 * Guiding principle: Useful information always comes first. The humor exists around
 * the information rather than replacing it. Serious situations (data safety, auth,
 * cryptographic keys, destructive deletion) use Serious Mode: clear, direct, and no jokes.
 */

export type CopyTone = "normal" | "mild" | "chaotic" | "rare";

export type CopyVariants = {
  normal: string;
  mild?: string;
  chaotic?: string;
  rare?: string;
};

/**
 * Deterministically select a copy variant based on a stable seed string
 * (e.g. task ID, date string, or entity key).
 * Adheres to 65% normal / 25% mild / 9% chaotic / 1% rare.
 * Using a deterministic seed prevents hydration mismatches and rapid re-render flicker.
 */
export function selectCopyVariant(variants: CopyVariants, seed?: string): string {
  if (!seed) return variants.normal;

  // Simple, deterministic FNV-1a hash of the seed string
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const normalized = Math.abs(hash % 100); // 0–99

  if (normalized >= 99 && variants.rare) {
    return variants.rare;
  }
  if (normalized >= 90 && variants.chaotic) {
    return variants.chaotic;
  }
  if (normalized >= 65 && variants.mild) {
    return variants.mild;
  }
  return variants.normal;
}

export const copy = {
  brand: {
    name: "Adulting.exe",
    tagline: "I built this shit for myself because apparently I need software to keep my life together.",
    shortTagline: "Keeping it together.",
    manifesto: "One user. One increasingly unreasonable codebase. One very small planet.",
    footerMeta: {
      designedFor: "Kyle",
      designedBy: "also Kyle",
    },
  },

  navigation: {
    home: {
      label: "So, Ano Na?",
      shortLabel: "Ano Na?",
      description: "Today's overview, classes, and immediate commitments.",
    },
    tasks: {
      label: "Shit to Do",
      shortLabel: "Shit to Do",
      description: "Priorities, deadlines, and things you've been avoiding.",
    },
    calendar: {
      label: "My Alleged Schedule",
      shortLabel: "Schedule",
      description: "Events, classes, and supposedly free time.",
    },
    school: {
      label: "Academic Suffering",
      shortLabel: "Suffering",
      description: "Courses, deadlines, and Blackboard drops.",
    },
    focus: {
      label: "Lock In mofo",
      shortLabel: "Lock In",
      description: "Distraction-free execution. Gawin mo na.",
    },
    inbox: {
      label: "Unsorted Bullshit",
      shortLabel: "Bullshit",
      description: "Raw input and proposals waiting for triage.",
    },
    notes: {
      label: "Notes",
      shortLabel: "Notes",
      description: "Quiet Markdown notes and private context.",
    },
    more: {
      label: "More",
      shortLabel: "More",
      description: "Preferences, integrations, receipts, and deferred life areas.",
    },
  },

  plannedAreas: {
    antiGastador: {
      name: "Anti-Gastador",
      title: "Anti-Gastador",
      route: "/anti-gastador",
      status: "Not cooked yet",
      headline: "Financial responsibility is still under construction.",
      description:
        "Eventually this is where I figure out whether buying something now fucks over something more important later.",
      detail:
        "Eventually this is where I figure out whether buying something now fucks over something more important later.",
      summary: "Figure out if buying something now fucks over later.",
      capabilities: [
        "Money I actually have vs. money I pretend I have",
        "Expected & uncertain income scenarios",
        "Major future expenses & sinking funds",
        "Planned purchases & impulse cooldown timer",
        '"Can I afford this?" simulation mode',
      ],
      secondaryNote: "Existing in my head since 2026.",
      illustration: "anti-gastador" as const,
    },
    soon: {
      name: "Soon™",
      title: "Soon™",
      route: "/soon",
      status: "Still cooking",
      headline: "Soon™ is, unfortunately, living up to its name.",
      description:
        "Games I want to play, what I'm actually playing, and eventually proof of how much time disappeared into them.",
      detail:
        "Games I want to play, what I'm actually playing, and eventually proof of how much time disappeared into them.",
      summary: "Games I want to play and proof of disappeared hours.",
      capabilities: [
        "Want to Play & currently Playing lists",
        "Steam and launcher integrations",
        "Local play-session tracking & playtime detection",
        "Gaming backlog history and abandoned playthroughs",
      ],
      secondaryNote: "Current implementation status: vibes.",
      illustration: "soon" as const,
    },
    media: {
      name: "Things to Consume Before I Die",
      title: "Things to Consume Before I Die",
      route: "/consume",
      status: "Currently somebody else's problem",
      headline: "The backlog already exists. The interface is catching up.",
      description:
        "Movies, shows, books, articles, music, podcasts, and all the other shit I swear I'll get to eventually.",
      detail:
        "Movies, shows, books, articles, music, podcasts, and all the other shit I swear I'll get to eventually.",
      summary: "Movies, shows, books, articles, and eternal backlog.",
      capabilities: [
        "Watchlist for films and serialized shows",
        "Reading stack for books, articles, and essays",
        "Listen queue for albums and podcasts",
        "Quick media capture from browser or clipboard",
        "Recommendation context and who recommended it",
      ],
      secondaryNote: "There are plans. Concerning amounts of plans.",
      illustration: "consume" as const,
    },
    journal: {
      name: "Dear Dumbass",
      title: "Dear Dumbass",
      route: "/dear-dumbass",
      status: "Not cooked yet",
      headline: "I have thoughts. The app doesn't. Yet.",
      description:
        "Journal entries, random thoughts, little moments, and whatever future me might actually want to remember.",
      detail:
        "Journal entries, random thoughts, little moments, and whatever future me might actually want to remember.",
      summary: "Journal entries, thoughts, and memories for future me.",
      capabilities: [
        "Unfiltered stream-of-consciousness journaling",
        "Moments & snapshot reflections",
        "Text, photo, and quick voice capture",
        "Local personal context safely preserved",
      ],
      secondaryNote: "Calm entries for future reference.",
      illustration: "dear-dumbass" as const,
    },
    lore: {
      name: "Lore",
      title: "Lore",
      route: "/lore",
      status: "Awaiting questionable engineering decisions",
      headline: "Your lore is still compiling.",
      description:
        "Eventually: a timeline of where I've been, what happened, what changed, and all the stupid little details that somehow became canon.",
      detail:
        "Eventually: a timeline of where I've been, what happened, what changed, and all the stupid little details that somehow became canon.",
      summary: "Personal timeline of canon events and stupid details.",
      capabilities: [
        "Personal timeline snaking through past milestones",
        "Memories and photo anchors from specific eras",
        "Historical context and personal turning points",
        "Memory Trails connecting related life events",
        'Callbacks to past events and "THE INCIDENT"',
      ],
      secondaryNote: "Compiling since day one.",
      illustration: "lore" as const,
    },
    people: {
      name: "These Mfs",
      title: "These Mfs",
      route: "/people",
      status: "Somehow not implemented",
      headline: "I do, in fact, know people.",
      description:
        "Eventually this is where people naturally connect to birthdays, trips, memories, plans, and all the other lore they've somehow become part of.",
      detail:
        "Eventually this is where people naturally connect to birthdays, trips, memories, plans, and all the other lore they've somehow become part of.",
      summary: "Connecting people to birthdays, trips, and memories.",
      capabilities: [
        "People directory (friends, family, recurring characters)",
        "Birthdays, anniversaries & recurring dates",
        "Shared Moments and photo milestones",
        "Trips, places & hangouts attended together",
        "Relationship context (strictly zero CRM energy)",
      ],
      secondaryNote: "Zero CRM energy allowed.",
      illustration: "people" as const,
    },
    gala: {
      name: "Gala",
      title: "Gala",
      route: "/gala",
      status: "Still cooking",
      headline: "Currently traveling to the implementation phase.",
      description:
        "Trips, places I want to go, places I've already been, and somewhere to dump the café I found at 2 AM.",
      detail:
        "Trips, places I want to go, places I've already been, and somewhere to dump the café I found at 2 AM.",
      summary: "Trips, places to visit, and cafés found at 2 AM.",
      capabilities: [
        "Multi-day trip planning & packing checklists",
        "Saved places, food spots & late-night cafés",
        "Lightweight itineraries without overplanning",
        "Past destinations archive & travel memories",
        "Photo memories pinned to locations",
      ],
      secondaryNote: "Packing luggage in a background thread.",
      illustration: "gala" as const,
    },
    football: {
      name: "Football (EFU)",
      title: "Football (EFU)",
      route: "/football",
      status: "Check back later",
      headline: "The football department has no software yet.",
      description:
        "Eventually: sessions, progress, games, training, and enough context to actually see whether I'm getting better.",
      detail:
        "Eventually: sessions, progress, games, training, and enough context to actually see whether I'm getting better.",
      summary: "Sessions, games, training, and EFU club context.",
      capabilities: [
        "Training sessions and individual drills log",
        "Matches, lineups, and matchday results",
        "Development notes & tactical focus areas",
        "East Football United schedule & club context",
      ],
      secondaryNote: "Turns out playing football was easier than building the app.",
      illustration: "football" as const,
    },
    skills: {
      name: "Skills",
      title: "Skills",
      route: "/skills",
      status: "Not cooked yet",
      headline: "Skill issue. Literally.",
      description:
        "Things I'm learning, things I want to get better at, and eventually some evidence that I actually improved.",
      detail:
        "Things I'm learning, things I want to get better at, and eventually some evidence that I actually improved.",
      summary: "Things I'm learning and proof of actual progress.",
      capabilities: [
        "Skills inventory & aspirational learning map",
        "Practice sessions & progress logging",
        "Associated projects & practical proofs of work",
        "Milestones & tangible breakthroughs",
      ],
      secondaryNote: "No fake XP or streak counters.",
      illustration: "skills" as const,
    },
    privateData: {
      name: "None of Your Business",
      title: "None of Your Business",
      route: "/private",
      status: "Check back after I stop adding features",
      headline: "Your digital hoard deserves proper shelving.",
      description:
        "The local-only side of Adulting.exe: private history, personal data, memories, and the shit that does not belong in the cloud.",
      detail:
        "The local-only side of Adulting.exe: private history, personal data, memories, and the shit that does not belong in the cloud.",
      summary: "Local-only private vault for data that stays off cloud.",
      privacyNotice:
        "Planned private data will stay local and will not be stored in Adulting.exe's cloud services.",
      capabilities: [
        "Local-only encrypted vault partition",
        "Imported personal archives & sensitive exports",
        "Raw timeline & unredacted search history",
        "Local companion AI context boundaries",
        "P2P trusted-device synchronization",
      ],
      secondaryNote: "Strictly on your machine.",
      illustration: "private" as const,
    },
  },

  emptyStates: {
    tasks: {
      today: {
        title: "Nothing to do. Fucking finally.",
        description: "Nothing scheduled or due today. Enjoy the open space or capture a next step.",
      },
      next7: {
        title: "Next 7 days are clear",
        description: "No tasks due across the upcoming week. Suspicious.",
      },
      overdue: {
        title: "No overdue tasks",
        description: "Zero overdue. Keep it that way.",
      },
      inbox: {
        title: "No unsorted bullshit",
        description: "Tasks captured without a due date will wait here for triage.",
      },
      tomorrow: {
        title: "Tomorrow is clear",
        description: "Nothing due tomorrow. Chill.",
      },
      someday: {
        title: "No backlog tasks",
        description: "Undated someday tasks will wait here.",
      },
      submitted: {
        title: "No submitted tasks",
        description: "Assignments and tasks marked submitted will appear here.",
      },
      completed: {
        title: "Nothing completed yet",
        description: "Tasks you finish will show up here as a record of your work.",
      },
    },

    calendar: {
      dayClear: {
        title: "Nothing scheduled.",
        subtitle: "Your day is open.",
      },
    },

    school: {
      noClassesToday: "No classes today. Aba himala.",
      classesFinished: "Classes finished for today. Keep the rest of the day.",
      noUpcomingWork: {
        title: "Nothing due right now",
        description: "You're completely caught up on your academic deadlines.",
      },
    },

    inbox: {
      title: "No unsorted bullshit.",
      description: "Weird. Drop something in to add to the pile.",
    },
  },

  home: {
    eyebrow: "SO, ANO NA?",
    subtexts: [
      "Okay, what the fuck is happening today?",
      "Here's where things stand.",
      "Let's see what we're dealing with.",
    ],
  },

  capture: {
    launcherTitle: "Unsorted Bullshit",
    launcherSubtitle: "Dito muna.",
    placeholder: "Whatever this is, put it here. I'll sort it later… (e.g. 'Submit Physics lab report by Friday 5pm')",
    openInbox: "Open Unsorted Bullshit →",
  },

  errors: {
    genericTitle: "Something broke.",
    genericMessage: "The app hit an unexpected error. Your saved data is safe.",
    notFoundTitle: "Page not found",
    notFoundMessage: "Ano hinahanap mo dito? There's nothing at this URL. Your data is fine.",
  },
} as const;
