/** catalog — the static persona-core data + resolvers.
 *
 *  Everything about "what can be configured" lives here: the 20-trait vocabulary
 *  (distilled from the 120-persona corpus; each trait carries a lucide icon + a
 *  directive), the five axes, the conflict styles, the archetype→dominant-traits
 *  presets, and the model / reasoning-effort tiers. usePersonaCore owns "what is
 *  selected"; the components render this data. Character in the library lives in
 *  PROSE, not dials — only 18 of 120 personas carry numeric `core` — so discrete
 *  traits (not sliders) carry most of the personality.
 */
import {
  Microscope, Gauge, Anchor, Shield, Siren, UserCheck, Lock, Layers, Minimize2,
  VolumeX, ListTree, Zap, Repeat, Flag, Database, BellOff, GraduationCap,
  ShieldCheck, Swords, Rocket, Flame, Scale, Wrench, Handshake, ScanSearch,
  ShieldHalf, MessagesSquare, Sparkles, LineChart, Radar, Workflow, Activity,
  LibraryBig, Palette, ConciergeBell, Feather, Brain, type LucideIcon,
} from "lucide-react";
import { EFFORT_OPTIONS, type EffortOption } from "@/lib/models/modelCatalog";
import type { AgentsKey, CharacterTrait, TraitAxis, ModelTier, EffortLevel } from "./types";

/** The persona-core accent (also the model-tier accent). */
export const ACCENT = "#60A5FA";

/** The control accents that are NOT axis colours.
 *
 *  They were raw hex literals at their call sites, and each re-used an axis
 *  colour for an unrelated concept: the conflict tiles wrote
 *  TRAIT_AXES.temperament's `#fbbf24`, and the effort meter declared a local
 *  `purple` that appeared nowhere else. A colour edit therefore meant grepping
 *  call sites and guessing which uses of a hex meant the same thing.
 *
 *  They are separate constants rather than aliases of the axis colours ON
 *  PURPOSE: sharing a value is not sharing a meaning.
 *
 *  `DISPOSITION_ACCENT` and `DEFAULT_DISPOSITION` were removed with the
 *  disposition slider (agent-manifest rebase, 2026-09-04). */
export const CONFLICT_ACCENT = "#fbbf24";
export const EFFORT_ACCENT = "#a78bfa";

// -- Archetype icon resolver -------------------------------------------------
/** The `icon` names the shipped archetype catalog actually uses
 *  (`scripts/templates/_archetypes.json`), and nothing else. Five further
 *  entries (Target, Brain, Users, BookOpenCheck, NotebookPen) were residue of
 *  the retired Foundry: no archetype referenced them, so they only pulled dead
 *  lucide imports into the chunk. `personaCore.test.tsx` pins the map to the
 *  shipped catalog in BOTH directions, so a new archetype icon fails loudly
 *  here instead of silently falling back to Sparkles. */
export const CORE_ICONS: Record<string, LucideIcon> = {
  ShieldCheck, LineChart, Radar, Workflow, Activity, LibraryBig, Palette,
  Rocket, ConciergeBell,
};
export function coreIcon(name: string): LucideIcon {
  return CORE_ICONS[name] ?? Sparkles;
}

// -- Character axes + trait vocabulary ---------------------------------------
export const TRAIT_AXES: { id: TraitAxis; labelKey: AgentsKey; color: string; icon: LucideIcon }[] = [
  { id: "rigor", labelKey: "core_axis_rigor", color: "#60a5fa", icon: ScanSearch },
  { id: "autonomy", labelKey: "core_axis_autonomy", color: "#fb7185", icon: ShieldHalf },
  { id: "communication", labelKey: "core_axis_communication", color: "#2dd4bf", icon: MessagesSquare },
  { id: "reliability", labelKey: "core_axis_reliability", color: "#c084fc", icon: Repeat },
  { id: "temperament", labelKey: "core_axis_temperament", color: "#fbbf24", icon: Sparkles },
];

export const TRAIT_CATALOG: CharacterTrait[] = [
  // Rigor & evidence
  { id: "evidence-first", axis: "rigor", labelKey: "core_trait_evidence_first", count: 47, icon: Microscope, blurbKey: "core_trait_evidence_first_blurb", directive: "Cite evidence for every claim; never assert without a source." },
  { id: "states-confidence", axis: "rigor", labelKey: "core_trait_states_confidence", count: 41, icon: Gauge, blurbKey: "core_trait_states_confidence_blurb", directive: "State confidence explicitly and separate fact from interpretation and speculation." },
  { id: "baseline-anchor", axis: "rigor", labelKey: "core_trait_baseline_anchor", count: 31, icon: Anchor, blurbKey: "core_trait_baseline_anchor_blurb", directive: "Anchor every metric to a baseline or prior period; never present a bare number." },
  { id: "conservative", axis: "rigor", labelKey: "core_trait_conservative", count: 9, icon: Shield, blurbKey: "core_trait_conservative_blurb", directive: "When uncertain, err to the cautious side; a false alarm is cheaper than a silent miss." },
  // Autonomy & deference
  { id: "escalates", axis: "autonomy", labelKey: "core_trait_escalates", count: 66, icon: Siren, blurbKey: "core_trait_escalates_blurb", directive: "When uncertain or ambiguous, escalate or ask rather than guess." },
  { id: "human-closure", axis: "autonomy", labelKey: "core_trait_human_closure", count: 39, icon: UserCheck, blurbKey: "core_trait_human_closure_blurb", directive: "Never send, commit, or publish without explicit human approval." },
  { id: "no-destructive", axis: "autonomy", labelKey: "core_trait_no_destructive", count: 21, icon: Lock, blurbKey: "core_trait_no_destructive_blurb", directive: "Never take destructive or irreversible actions automatically — draft, queue, and confirm first." },
  { id: "tiered-autonomy", axis: "autonomy", labelKey: "core_trait_tiered_autonomy", count: 10, icon: Layers, blurbKey: "core_trait_tiered_autonomy_blurb", directive: "Auto-apply safe changes; route risky ones to review." },
  // Communication
  { id: "terse", axis: "communication", labelKey: "core_trait_terse", count: 48, icon: Minimize2, blurbKey: "core_trait_terse_blurb", directive: "Be terse — signal over volume, no padding; a quiet period gets a short note." },
  { id: "no-hype", axis: "communication", labelKey: "core_trait_no_hype", count: 40, icon: VolumeX, blurbKey: "core_trait_no_hype_blurb", directive: "Write plainly — no hype, no hedging, numbers-led." },
  { id: "structured", axis: "communication", labelKey: "core_trait_structured", count: 40, icon: ListTree, blurbKey: "core_trait_structured_blurb", directive: "Use a consistent structured format — numbered, grouped by severity or owner." },
  { id: "actionable", axis: "communication", labelKey: "core_trait_actionable", count: 18, icon: Zap, blurbKey: "core_trait_actionable_blurb", directive: "Make every output actionable — each item ends in a concrete next step." },
  // Reliability & ops
  { id: "idempotent", axis: "reliability", labelKey: "core_trait_idempotent", count: 46, icon: Repeat, blurbKey: "core_trait_idempotent_blurb", directive: "Be idempotent — dedupe on stable keys; never process the same item twice." },
  { id: "reports-gaps", axis: "reliability", labelKey: "core_trait_reports_gaps", count: 23, icon: Flag, blurbKey: "core_trait_reports_gaps_blurb", directive: "Report gaps and partial coverage explicitly; a failed check is itself a finding." },
  { id: "single-truth", axis: "reliability", labelKey: "core_trait_single_truth", count: 22, icon: Database, blurbKey: "core_trait_single_truth_blurb", directive: "Treat one system as the source of truth; other views mirror it, never fork it." },
  { id: "silent-when-healthy", axis: "reliability", labelKey: "core_trait_silent_when_healthy", count: 10, icon: BellOff, blurbKey: "core_trait_silent_when_healthy_blurb", directive: "Stay silent when everything is within normal; alert only on genuine thresholds, once per incident." },
  // Temperament & drive
  { id: "learns", axis: "temperament", labelKey: "core_trait_learns", count: 19, icon: GraduationCap, blurbKey: "core_trait_learns_blurb", directive: "Learn from corrections — adapt to feedback so mistakes don't repeat." },
  { id: "quality-gate", axis: "temperament", labelKey: "core_trait_quality_gate", count: 9, icon: ShieldCheck, blurbKey: "core_trait_quality_gate_blurb", directive: "Hold a hard quality gate — block on critical findings even under time pressure." },
  { id: "challenges", axis: "temperament", labelKey: "core_trait_challenges", count: 7, icon: Swords, blurbKey: "core_trait_challenges_blurb", directive: "Push back — surface tension and challenge consensus rather than going along." },
  { id: "ships-fast", axis: "temperament", labelKey: "core_trait_ships_fast", count: 5, icon: Rocket, blurbKey: "core_trait_ships_fast_blurb", directive: "Favour momentum — ship the smallest working thing and iterate on real feedback." },
];

export function traitById(id: string): CharacterTrait | undefined {
  return TRAIT_CATALOG.find((t) => t.id === id);
}

// -- Conflict styles (temperament in disagreement) ---------------------------
export const CONFLICT_STYLES: { id: string; labelKey: AgentsKey; blurbKey: AgentsKey; icon: LucideIcon }[] = [
  { id: "challenger", labelKey: "core_conflict_challenger", icon: Flame, blurbKey: "core_conflict_challenger_blurb" },
  { id: "analyst", labelKey: "core_conflict_analyst", icon: Scale, blurbKey: "core_conflict_analyst_blurb" },
  { id: "pragmatist", labelKey: "core_conflict_pragmatist", icon: Wrench, blurbKey: "core_conflict_pragmatist_blurb" },
  { id: "harmonizer", labelKey: "core_conflict_harmonizer", icon: Handshake, blurbKey: "core_conflict_harmonizer_blurb" },
];

export const CONFLICT_DIRECTIVE: Record<string, string> = {
  challenger: "In disagreement, push back and block when warranted rather than defer.",
  analyst: "In disagreement, argue from evidence and let the data settle it.",
  pragmatist: "In disagreement, seek the workable path and trade perfect for shipped.",
  harmonizer: "In disagreement, smooth friction and keep things moving toward consensus.",
};

// -- Archetype presets: dominant traits preloaded when a snapshot loads -------
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

// -- Engine tiers ------------------------------------------------------------
/** `relativeCost` is the tier's Anthropic list price per million tokens expressed
 *  as a multiple of the cheapest tier, so the screen where a user picks a model
 *  carries a spend signal instead of capability prose alone. Sourced from the
 *  published API price list (Haiku $1 / Sonnet $3 / Opus $5 per M input tokens,
 *  read 2026-08-28); the ratio holds for output tokens too ($5 / $15 / $25).
 *  It is a RATIO, deliberately — an absolute figure would go stale silently
 *  and this surface has no per-run token estimate to multiply it by. Effort
 *  tiers carry no such number: raising effort raises token spend, but Anthropic
 *  publishes no multiplier for it, and inventing one would be worse than the
 *  ascending meter already communicating relative depth.
 *
 *  A model tier, enumerated ONCE. The icon used to live in ConfigTiles' own
 *  `MODEL_ICON` map and the prompt word in a ternary inside usePersonaCore, so
 *  the same three tiers were written out in three files and a fourth tier would
 *  have had to be added to all three (with only this one failing a test). */
export const MODEL_TIERS: { id: ModelTier; label: string; blurbKey: AgentsKey; icon: LucideIcon; promptWord: string; relativeCost: number }[] = [
  { id: "haiku", label: "Haiku", icon: Feather, promptWord: "Haiku (fast)", relativeCost: 1, blurbKey: "core_model_haiku_blurb" },
  { id: "sonnet", label: "Sonnet", icon: Sparkles, promptWord: "Sonnet (balanced)", relativeCost: 3, blurbKey: "core_model_sonnet_blurb" },
  { id: "opus", label: "Opus", icon: Brain, promptWord: "Opus (max reasoning)", relativeCost: 5, blurbKey: "core_model_opus_blurb" },
];

export function modelTier(id: ModelTier) {
  return MODEL_TIERS.find((m) => m.id === id) ?? MODEL_TIERS[1]!;
}

/** Blurbs are this surface's own copy; the ID LIST AND THE LABEL are not.
 *  `modelCatalog` owns the effort vocabulary the backend is wired to, so the
 *  tiers are DERIVED from `EFFORT_OPTIONS` rather than re-typed here — labels
 *  included, via each option's `labelKey`. The re-typed copy had drifted
 *  (`xhigh` was labelled "Max" here, and hardcoded English besides), and a
 *  fifth level added to modelCatalog would simply never have appeared in this
 *  modal. The app-wide English label for `xhigh` is now "Max" — this is that
 *  key's first real call site, and it had been left holding the raw id. */
const EFFORT_BLURB_KEYS: Record<EffortLevel, AgentsKey> = {
  low: "core_effort_low_blurb",
  medium: "core_effort_medium_blurb",
  high: "core_effort_high_blurb",
  xhigh: "core_effort_xhigh_blurb",
};

export const EFFORT_TIERS: { id: EffortLevel; labelKey: EffortOption["labelKey"]; blurbKey: AgentsKey }[] =
  EFFORT_OPTIONS.map((o) => ({ id: o.id, labelKey: o.labelKey, blurbKey: EFFORT_BLURB_KEYS[o.id] }));
