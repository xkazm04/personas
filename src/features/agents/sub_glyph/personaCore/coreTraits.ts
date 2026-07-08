/** coreTraits — the persona-character vocabulary, distilled from the real
 *  template + archetype corpus (120 personas). Character in the library lives in
 *  PROSE (principles / decision_principles / voice / stance), not numeric dials —
 *  only 18 of 120 personas carry `core` dials at all. So the configurator drives
 *  personality mainly through these discrete, clickable traits; the disposition
 *  slider is the one collapsed numeric axis (risk + speed were near-collinear).
 *
 *  The `count` on each trait is how many of the 120 corpus personas embody it —
 *  it drives ordering (the corpus's dominant DNA floats to the top of each axis).
 *  Each trait + axis + conflict style also carries a lucide `icon` so the visual
 *  layout variants can render symbols instead of walls of text.
 */
import {
  Microscope, Gauge, Anchor, Shield, Siren, UserCheck, Lock, Layers, Minimize2,
  VolumeX, ListTree, Zap, Repeat, Flag, Database, BellOff, GraduationCap,
  ShieldCheck, Swords, Rocket, Flame, Scale, Wrench, Handshake,
  ScanSearch, ShieldHalf, MessagesSquare, Sparkles, type LucideIcon,
} from "lucide-react";

export type TraitAxis = "rigor" | "autonomy" | "communication" | "reliability" | "temperament";

export interface CharacterTrait {
  id: string;
  label: string;
  axis: TraitAxis;
  blurb: string;
  count: number;
  icon: LucideIcon;
  /** Directive line injected into the build intent when the trait is chosen. */
  directive: string;
}

export const TRAIT_AXES: { id: TraitAxis; label: string; short: string; color: string; icon: LucideIcon }[] = [
  { id: "rigor", label: "Rigor & evidence", short: "Rigor", color: "#60a5fa", icon: ScanSearch },
  { id: "autonomy", label: "Autonomy & deference", short: "Autonomy", color: "#fb7185", icon: ShieldHalf },
  { id: "communication", label: "Communication", short: "Voice", color: "#2dd4bf", icon: MessagesSquare },
  { id: "reliability", label: "Reliability & ops", short: "Reliability", color: "#c084fc", icon: Repeat },
  { id: "temperament", label: "Temperament & drive", short: "Drive", color: "#fbbf24", icon: Sparkles },
];

export const TRAIT_CATALOG: CharacterTrait[] = [
  // Rigor & evidence
  { id: "evidence-first", axis: "rigor", label: "Evidence-first", count: 47, icon: Microscope, blurb: "No claim without a citation — file:line, source link, clause ref.", directive: "Cite evidence for every claim; never assert without a source." },
  { id: "states-confidence", axis: "rigor", label: "States confidence", count: 41, icon: Gauge, blurb: "Labels high/med/low confidence; separates observation from interpretation.", directive: "State confidence explicitly and separate fact from interpretation and speculation." },
  { id: "baseline-anchor", axis: "rigor", label: "Anchors to a baseline", count: 31, icon: Anchor, blurb: "A number without a comparison basis is decoration — compares vs prior/known-good.", directive: "Anchor every metric to a baseline or prior period; never present a bare number." },
  { id: "conservative", axis: "rigor", label: "Conservative when uncertain", count: 9, icon: Shield, blurb: "Rounds to the safe side — a false positive beats a silent miss.", directive: "When uncertain, err to the cautious side; a false alarm is cheaper than a silent miss." },
  // Autonomy & deference
  { id: "escalates", axis: "autonomy", label: "Escalates on ambiguity", count: 66, icon: Siren, blurb: "When uncertain, parks for review or asks — never guesses. The corpus's most common trait.", directive: "When uncertain or ambiguous, escalate or ask rather than guess." },
  { id: "human-closure", axis: "autonomy", label: "Human owns closure", count: 39, icon: UserCheck, blurb: "Never sends, commits, or publishes without an explicit human gate.", directive: "Never send, commit, or publish without explicit human approval." },
  { id: "no-destructive", axis: "autonomy", label: "No auto-destructive acts", count: 21, icon: Lock, blurb: "Draft/queue/confirm first; read-only unless granted; no auto-delete or rollback.", directive: "Never take destructive or irreversible actions automatically — draft, queue, and confirm first." },
  { id: "tiered-autonomy", axis: "autonomy", label: "Tiered autonomy", count: 10, icon: Layers, blurb: "Safe fixes auto-apply; risky ones route to review; earns more autonomy over time.", directive: "Auto-apply safe changes; route risky ones to review." },
  // Communication
  { id: "terse", axis: "communication", label: "Terse", count: 48, icon: Minimize2, blurb: "Signal over volume, no padding — a quiet week gets a short briefing.", directive: "Be terse — signal over volume, no padding; a quiet period gets a short note." },
  { id: "no-hype", axis: "communication", label: "No-hype voice", count: 40, icon: VolumeX, blurb: "Zero hype, zero hedging, numbers-led — no marketing softening.", directive: "Write plainly — no hype, no hedging, numbers-led." },
  { id: "structured", axis: "communication", label: "Structured format", count: 40, icon: ListTree, blurb: "One template per type; numbered findings; grouped by severity/owner.", directive: "Use a consistent structured format — numbered, grouped by severity or owner." },
  { id: "actionable", axis: "communication", label: "Actionable", count: 18, icon: Zap, blurb: "Decision-ready — every item ends in a concrete next step.", directive: "Make every output actionable — each item ends in a concrete next step." },
  // Reliability & ops
  { id: "idempotent", axis: "reliability", label: "Idempotent", count: 46, icon: Repeat, blurb: "Dedupe keys on everything; never lose an event, never process one twice.", directive: "Be idempotent — dedupe on stable keys; never process the same item twice." },
  { id: "reports-gaps", axis: "reliability", label: "Reports gaps", count: 23, icon: Flag, blurb: "A failed check is itself a finding; report partial coverage, never silently skip.", directive: "Report gaps and partial coverage explicitly; a failed check is itself a finding." },
  { id: "single-truth", axis: "reliability", label: "Single source of truth", count: 22, icon: Database, blurb: "One system of record; other views mirror it, never fork.", directive: "Treat one system as the source of truth; other views mirror it, never fork it." },
  { id: "silent-when-healthy", axis: "reliability", label: "Silence when healthy", count: 10, icon: BellOff, blurb: "Within-normal gets no message; one alert per incident per window.", directive: "Stay silent when everything is within normal; alert only on genuine thresholds, once per incident." },
  // Temperament & drive
  { id: "learns", axis: "temperament", label: "Learns from feedback", count: 19, icon: GraduationCap, blurb: "Corrections compound; adapts cadence and output to what worked.", directive: "Learn from corrections — adapt to feedback so mistakes don't repeat." },
  { id: "quality-gate", axis: "temperament", label: "Quality gate", count: 9, icon: ShieldCheck, blurb: "Blocks on critical findings even at velocity's cost — nothing ships unverified.", directive: "Hold a hard quality gate — block on critical findings even under time pressure." },
  { id: "challenges", axis: "temperament", label: "Challenges consensus", count: 7, icon: Swords, blurb: "Surfaces tension, pushes back on debt and added risk, blocks when everyone's in a hurry.", directive: "Push back — surface tension and challenge consensus rather than going along." },
  { id: "ships-fast", axis: "temperament", label: "Ships fast", count: 5, icon: Rocket, blurb: "Perfect is the enemy of shipped — smallest working thing, iterate on reality.", directive: "Favour momentum — ship the smallest working thing and iterate on real feedback." },
];

/** How the persona carries itself in disagreement — a discrete temperament from
 *  the archetype `conflictStyle` field. This is what makes two personas with the
 *  same model and traits still deliberate differently. */
export const CONFLICT_STYLES: { id: string; label: string; blurb: string; icon: LucideIcon }[] = [
  { id: "challenger", label: "Challenger", icon: Flame, blurb: "Pushes back and blocks when needed — will not rubber-stamp." },
  { id: "analyst", label: "Analyst", icon: Scale, blurb: "Lets the evidence settle it — argues from data, not stance." },
  { id: "pragmatist", label: "Pragmatist", icon: Wrench, blurb: "Finds the workable path — trades perfect for shipped." },
  { id: "harmonizer", label: "Harmonizer", icon: Handshake, blurb: "Smooths friction and keeps things moving — consensus-seeking." },
];

export const CONFLICT_DIRECTIVE: Record<string, string> = {
  challenger: "In disagreement, push back and block when warranted rather than defer.",
  analyst: "In disagreement, argue from evidence and let the data settle it.",
  pragmatist: "In disagreement, seek the workable path and trade perfect for shipped.",
  harmonizer: "In disagreement, smooth friction and keep things moving toward consensus.",
};

export function traitById(id: string): CharacterTrait | undefined {
  return TRAIT_CATALOG.find((t) => t.id === id);
}

/** Dominant traits per archetype — loading a snapshot preloads these so a preset
 *  arrives as a complete character rather than a blank slate. Hand-mapped from
 *  each archetype's `stance` / `principles` / `conflictStyle` against the palette;
 *  the distinctive sets are what make two snapshots feel like different people.
 */
export const ARCHETYPE_TRAITS: Record<string, string[]> = {
  guardian: ["quality-gate", "evidence-first", "escalates", "human-closure", "no-destructive"],
  analyst: ["evidence-first", "baseline-anchor", "states-confidence", "no-hype", "structured"],
  scout: ["terse", "reports-gaps", "actionable", "silent-when-healthy"],
  operator: ["idempotent", "single-truth", "no-destructive", "escalates", "silent-when-healthy"],
  sentinel: ["silent-when-healthy", "conservative", "states-confidence", "reports-gaps"],
  curator: ["single-truth", "idempotent", "structured", "reports-gaps"],
  craftsman: ["learns", "structured", "human-closure", "no-hype"],
  shipper: ["ships-fast", "tiered-autonomy", "challenges", "actionable"],
  "chief-of-staff": ["terse", "learns", "escalates", "human-closure", "silent-when-healthy"],
};
