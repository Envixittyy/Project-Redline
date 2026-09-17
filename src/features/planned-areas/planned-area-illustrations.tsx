import {
  Activity,
  AlertTriangle,
  BookOpen,
  Calendar,
  Camera,
  Check,
  Clock,
  Compass,
  CreditCard,
  Film,
  Gamepad2,
  HardDrive,
  Headphones,
  Heart,
  HelpCircle,
  Layers,
  Lock,
  Luggage,
  MapPin,
  NotebookPen,
  Plane,
  Receipt,
  Server,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";

import styles from "./planned-area-illustrations.module.css";

export type IllustrationType =
  | "anti-gastador"
  | "soon"
  | "consume"
  | "dear-dumbass"
  | "lore"
  | "people"
  | "gala"
  | "football"
  | "skills"
  | "private";

export function PlannedAreaIllustration({ type }: { type: IllustrationType }) {
  return (
    <div className={styles.illustrationCanvas} aria-hidden="true">
      <div className={styles.ambientGlow} />

      {type === "anti-gastador" && <AntiGastadorIllustration />}
      {type === "soon" && <SoonIllustration />}
      {type === "consume" && <ConsumeIllustration />}
      {type === "dear-dumbass" && <DearDumbassIllustration />}
      {type === "lore" && <LoreIllustration />}
      {type === "people" && <PeopleIllustration />}
      {type === "gala" && <GalaIllustration />}
      {type === "football" && <FootballIllustration />}
      {type === "skills" && <SkillsIllustration />}
      {type === "private" && <PrivateIllustration />}
    </div>
  );
}

/* 1. Anti-Gastador */
function AntiGastadorIllustration() {
  return (
    <>
      <div className={`${styles.primaryObject} ${styles.floatObject}`}>
        <div className={styles.glassIconFrame}>
          <CreditCard size={20} />
        </div>
        <div style={{ marginTop: "0.5rem", textAlign: "center" }}>
          <div style={{ fontSize: "0.65rem", color: "var(--text-tertiary)", letterSpacing: "0.05em" }}>
            SURVIVAL BUDGET
          </div>
          <div style={{ fontSize: "1.25rem", fontWeight: 750, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
            ₱ 0.00
          </div>
        </div>
      </div>

      {/* Orbiting Questionable Purchases */}
      <div className={`${styles.satelliteItem} ${styles.floatObjectReverse}`} style={{ top: "12%", right: "8%" }}>
        <div className={`${styles.expensePill} ${styles.expenseWarning}`}>
          <span>₱ 450.00</span>
          <span style={{ fontSize: "0.6rem", opacity: 0.8 }}>Iced Coffee</span>
        </div>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObject}`} style={{ bottom: "14%", right: "12%" }}>
        <div className={`${styles.expensePill} ${styles.expenseDanger}`}>
          <span>₱ 3,200.00</span>
          <span style={{ fontSize: "0.6rem", opacity: 0.8 }}>Impulse Buy</span>
        </div>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObjectReverse}`} style={{ top: "18%", left: "8%" }}>
        <div className={styles.glassCard}>
          <Wallet size={14} style={{ color: "var(--warning)" }} />
          <span style={{ fontSize: "0.68rem" }}>Wallet Status: Barely</span>
        </div>
      </div>

      <div className={`${styles.satelliteItem} ${styles.pulseObject}`} style={{ bottom: "16%", left: "14%" }}>
        <div className={styles.glassCard} style={{ padding: "0.3rem 0.5rem" }}>
          <Receipt size={13} style={{ color: "var(--text-tertiary)" }} />
          <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)" }}>Regret incoming?</span>
        </div>
      </div>
    </>
  );
}

/* 2. Soon™ */
function SoonIllustration() {
  return (
    <>
      <div className={`${styles.primaryObject} ${styles.floatObject}`}>
        <div className={styles.glassIconFrame}>
          <Gamepad2 size={24} />
        </div>
        <div style={{ marginTop: "0.5rem", textAlign: "center" }}>
          <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-secondary)" }}>
            Updating Game Engine...
          </span>
          <div className={styles.progressBarTrack}>
            <div className={styles.progressBarFill} />
          </div>
          <span style={{ fontSize: "0.6rem", color: "var(--accent-text)", marginTop: "0.2rem", display: "inline-block" }}>
            Stuck at 93%
          </span>
        </div>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObjectReverse}`} style={{ top: "14%", left: "10%" }}>
        <div className={styles.glassCard}>
          <Clock size={13} style={{ color: "var(--accent-text)" }} />
          <span>Backlog: 84 Unplayed</span>
        </div>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObject}`} style={{ bottom: "16%", right: "8%" }}>
        <div className={styles.glassCard}>
          <Trophy size={13} style={{ color: "var(--warning)" }} />
          <span>Playtime: 0 hrs</span>
        </div>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObjectReverse}`} style={{ top: "18%", right: "12%" }}>
        <div className={styles.glassCard} style={{ padding: "0.35rem 0.6rem" }}>
          <span style={{ fontSize: "0.68rem", color: "var(--text-secondary)" }}>GOTY Contender</span>
        </div>
      </div>
    </>
  );
}

/* 3. Things to Consume Before I Die */
function ConsumeIllustration() {
  return (
    <>
      <div className={`${styles.primaryObject} ${styles.floatObject}`} style={{ transform: "rotate(-2deg)" }}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <div className={styles.glassIconFrame}>
            <Film size={18} />
          </div>
          <div className={styles.glassIconFrame}>
            <BookOpen size={18} />
          </div>
          <div className={styles.glassIconFrame}>
            <Headphones size={18} />
          </div>
        </div>
        <div style={{ marginTop: "0.65rem", textAlign: "center" }}>
          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-primary)" }}>
            The Infinite Queue
          </span>
        </div>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObjectReverse}`} style={{ top: "10%", right: "10%" }}>
        <div className={styles.glassCard}>
          <Layers size={13} style={{ color: "var(--accent-text)" }} />
          <span>47 Open Browser Tabs</span>
        </div>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObject}`} style={{ bottom: "14%", left: "8%" }}>
        <div className={styles.glassCard}>
          <Sparkles size={13} style={{ color: "var(--warning)" }} />
          <span>&ldquo;I&apos;ll watch this tonight&rdquo;</span>
        </div>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObjectReverse}`} style={{ top: "14%", left: "10%" }}>
        <div className={styles.glassCard} style={{ padding: "0.3rem 0.55rem" }}>
          <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)" }}>Ep 1 of 840</span>
        </div>
      </div>
    </>
  );
}

/* 4. Dear Dumbass */
function DearDumbassIllustration() {
  return (
    <>
      <div className={`${styles.primaryObject} ${styles.floatObject}`} style={{ minWidth: "10.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", marginBottom: "0.35rem" }}>
          <NotebookPen size={16} style={{ color: "var(--accent-text)" }} />
          <span style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.04em", color: "var(--text-secondary)" }}>
            FIELD NOTES
          </span>
        </div>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <div style={{ height: "2px", width: "100%", background: "var(--border-subtle)", borderRadius: "1px" }} />
          <div style={{ height: "2px", width: "85%", background: "var(--border-subtle)", borderRadius: "1px" }} />
          <div style={{ height: "2px", width: "60%", background: "var(--border-subtle)", borderRadius: "1px" }} />
        </div>
      </div>

      {/* Polaroid photo */}
      <div className={`${styles.satelliteItem} ${styles.floatObjectReverse}`} style={{ top: "8%", right: "10%" }}>
        <div className={styles.polaroidFrame}>
          <div className={styles.polaroidPhoto}>
            <Camera size={16} />
          </div>
          <span className={styles.polaroidCaption}>A Moment</span>
        </div>
      </div>

      <div className={`${styles.satelliteItem} ${styles.pulseObject}`} style={{ bottom: "14%", left: "10%" }}>
        <div className={styles.glassCard}>
          <Heart size={13} style={{ color: "oklch(70% 0.18 20)" }} />
          <span>Note to Future Self</span>
        </div>
      </div>
    </>
  );
}

/* 5. Lore */
function LoreIllustration() {
  return (
    <>
      <div className={styles.timelineTrack} />

      <div className={`${styles.satelliteItem} ${styles.floatObject}`} style={{ left: "10%", top: "45%", transform: "translateY(-50%)" }}>
        <div className={styles.timelineNode} />
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObjectReverse}`} style={{ left: "8%", top: "14%" }}>
        <div className={styles.glassCard} style={{ padding: "0.35rem 0.6rem" }}>
          <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)" }}>Chapter 1: The Setup</span>
        </div>
      </div>

      {/* Centerpiece: THE INCIDENT */}
      <div className={`${styles.primaryObject} ${styles.floatObject}`} style={{ zIndex: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <AlertTriangle size={15} style={{ color: "var(--warning)" }} />
          <span style={{ fontSize: "0.78rem", fontWeight: 750, letterSpacing: "0.06em", color: "var(--warning-text)" }}>
            THE INCIDENT
          </span>
        </div>
        <span style={{ fontSize: "0.62rem", color: "var(--text-tertiary)", marginTop: "0.2rem" }}>
          Officially Canon
        </span>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObjectReverse}`} style={{ right: "8%", bottom: "16%" }}>
        <div className={styles.glassCard}>
          <Compass size={13} style={{ color: "var(--accent-text)" }} />
          <span>Timeline compiling...</span>
        </div>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObject}`} style={{ right: "12%", top: "45%", transform: "translateY(-50%)" }}>
        <div className={styles.timelineNode} style={{ opacity: 0.5 }} />
      </div>
    </>
  );
}

/* 6. These Mfs */
function PeopleIllustration() {
  return (
    <>
      <svg className={styles.connectorLine} viewBox="0 0 300 160" style={{ width: "100%", height: "100%" }}>
        <path d="M 60 40 Q 150 70 230 45" />
        <path d="M 70 120 Q 150 90 220 125" />
        <path d="M 150 70 L 150 110" />
      </svg>

      <div className={`${styles.primaryObject} ${styles.floatObject}`} style={{ minWidth: "8.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <Users size={16} style={{ color: "var(--accent-text)" }} />
          <span style={{ fontSize: "0.75rem", fontWeight: 700 }}>The Circle</span>
        </div>
        <span style={{ fontSize: "0.62rem", color: "var(--text-tertiary)", marginTop: "0.2rem" }}>
          Zero CRM Algorithms
        </span>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObjectReverse}`} style={{ top: "12%", left: "8%" }}>
        <div className={styles.glassCard}>
          <Calendar size={13} style={{ color: "var(--info)" }} />
          <span>Birthday in 4 days</span>
        </div>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObject}`} style={{ bottom: "14%", right: "8%" }}>
        <div className={styles.glassCard}>
          <HelpCircle size={13} style={{ color: "var(--text-secondary)" }} />
          <span>Borrowed hoodie (2024)</span>
        </div>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObjectReverse}`} style={{ top: "14%", right: "10%" }}>
        <div className={styles.glassCard} style={{ padding: "0.3rem 0.55rem" }}>
          <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--accent-text)" }}>KM · AJ · RV</span>
        </div>
      </div>
    </>
  );
}

/* 7. Gala */
function GalaIllustration() {
  return (
    <>
      <div className={`${styles.primaryObject} ${styles.floatObject}`}>
        <div className={styles.glassIconFrame}>
          <Luggage size={20} />
        </div>
        <div style={{ marginTop: "0.5rem", textAlign: "center" }}>
          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-primary)" }}>
            Next Destination
          </span>
          <span style={{ fontSize: "0.62rem", color: "var(--text-tertiary)", display: "block", marginTop: "0.15rem" }}>
            Itinerary pending inspiration
          </span>
        </div>
      </div>

      {/* Boarding pass ticket */}
      <div className={`${styles.satelliteItem} ${styles.floatObjectReverse}`} style={{ top: "10%", right: "8%" }}>
        <div className={styles.boardingPass}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", fontWeight: 700, color: "var(--accent-text)" }}>
            <span>MNL</span>
            <span>✈</span>
            <span>???</span>
          </div>
          <span style={{ fontSize: "0.55rem", color: "var(--text-muted)" }}>GATE: WHENEVER</span>
        </div>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObject}`} style={{ bottom: "14%", left: "10%" }}>
        <div className={styles.glassCard}>
          <MapPin size={13} style={{ color: "var(--destructive)" }} />
          <span>Café found at 2 AM</span>
        </div>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObjectReverse}`} style={{ top: "16%", left: "8%" }}>
        <div className={styles.glassCard} style={{ padding: "0.3rem 0.5rem" }}>
          <Plane size={13} style={{ color: "var(--accent-text)" }} />
          <span style={{ fontSize: "0.65rem" }}>Out of Office Mode</span>
        </div>
      </div>
    </>
  );
}

/* 8. Football (EFU) */
function FootballIllustration() {
  return (
    <>
      <div className={`${styles.primaryObject} ${styles.floatObject}`} style={{ padding: "0.75rem" }}>
        {/* Simple geometric pitch */}
        <svg className={styles.pitchSvg} viewBox="0 0 160 100">
          <rect x="5" y="5" width="150" height="90" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
          <line x1="80" y1="5" x2="80" y2="95" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
          <circle cx="80" cy="50" r="18" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
          <rect x="5" y="25" width="22" height="50" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.3" />
          <rect x="133" y="25" width="22" height="50" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.3" />
        </svg>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObjectReverse}`} style={{ top: "12%", left: "8%" }}>
        <div className={styles.glassCard}>
          <Trophy size={13} style={{ color: "var(--warning)" }} />
          <span>East Football United</span>
        </div>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObject}`} style={{ bottom: "14%", right: "8%" }}>
        <div className={styles.glassCard}>
          <Activity size={13} style={{ color: "var(--success)" }} />
          <span>Match Fitness: 68%</span>
        </div>
      </div>

      <div className={`${styles.satelliteItem} ${styles.floatObjectReverse}`} style={{ top: "14%", right: "10%" }}>
        <div className={styles.glassCard} style={{ padding: "0.3rem 0.55rem" }}>
          <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)" }}>Next Session · 19:00</span>
        </div>
      </div>
    </>
  );
}

/* 9. Skills */
function SkillsIllustration() {
  return (
    <>
      <svg viewBox="0 0 240 140" style={{ width: "100%", height: "100%", position: "absolute", zIndex: 1 }}>
        <line x1="60" y1="90" x2="120" y2="50" stroke="var(--accent)" strokeWidth="1.5" strokeOpacity="0.6" />
        <line x1="120" y1="50" x2="180" y2="90" stroke="var(--border-strong)" strokeWidth="1.5" strokeDasharray="3 3" />
        <line x1="120" y1="50" x2="120" y2="110" stroke="var(--border-strong)" strokeWidth="1.5" strokeDasharray="3 3" />
      </svg>

      {/* Root Node (Unlocked) */}
      <div className={`${styles.satelliteItem} ${styles.floatObject}`} style={{ left: "44%", top: "20%" }}>
        <div className={styles.primaryObject} style={{ padding: "0.55rem 0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <Check size={14} style={{ color: "var(--success)" }} />
            <span style={{ fontSize: "0.7rem", fontWeight: 700 }}>Foundations</span>
          </div>
        </div>
      </div>

      {/* Branch 1 (Active) */}
      <div className={`${styles.satelliteItem} ${styles.floatObjectReverse}`} style={{ left: "10%", bottom: "16%" }}>
        <div className={styles.glassCard}>
          <Sparkles size={13} style={{ color: "var(--accent-text)" }} />
          <span>In Progress</span>
        </div>
      </div>

      {/* Branch 2 (Locked) */}
      <div className={`${styles.satelliteItem} ${styles.floatObject}`} style={{ right: "10%", bottom: "16%" }}>
        <div className={styles.glassCard} style={{ opacity: 0.65 }}>
          <Lock size={13} />
          <span>Mastery (Locked)</span>
        </div>
      </div>
    </>
  );
}

/* 10. None of Your Business */
function PrivateIllustration() {
  return (
    <div className={styles.vaultBoundary}>
      <div className={styles.vaultTag}>
        <ShieldCheck size={13} />
        <span>127.0.0.1 ONLY · NO CLOUD EGRESS</span>
      </div>

      <div style={{ display: "flex", gap: "0.65rem", alignItems: "center" }}>
        <div className={styles.glassCard}>
          <Server size={14} style={{ color: "var(--info)" }} />
          <span>Local Vault</span>
        </div>
        <div className={styles.glassCard}>
          <HardDrive size={14} style={{ color: "var(--text-secondary)" }} />
          <span>Personal Archives</span>
        </div>
      </div>

      <div style={{ marginTop: "0.5rem", fontSize: "0.62rem", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
        Physical boundary locked · Zero cloud sync
      </div>
    </div>
  );
}
