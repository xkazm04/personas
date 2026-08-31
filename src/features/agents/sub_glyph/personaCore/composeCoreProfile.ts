/** composeCoreProfile — the codex choices, mapped onto the TYPED runtime Core.
 *
 *  Until now every Persona Core Codex choice (archetype, disposition, conflict
 *  style, traits) was flattened into a prose block (`launchAugmentation`) and
 *  discarded; the promoted persona's `core_profile` came only from whatever
 *  `persona.core` the build LLM happened to author. This module is the typed
 *  half: a pure mapping from `PersonaCoreState` to the `PersonaCore` binding
 *  (the `personas.core_profile` JSON column), so the operator's choices land
 *  byte-for-byte as the runtime Core.
 *
 *  Base + overlay semantics:
 *   • archetype selected → its authored `persona.core` (7 dials + prose) is the
 *     base, with persona-level identity/voice/principles/constraints flattened
 *     in — the same payload instant adopt stamps verbatim.
 *   • no archetype → the design payload's own `persona.core` (when the caller
 *     hands one in) is the base, so partial codex use overlays dials/traits
 *     without erasing LLM-authored prose; failing that, a neutral base.
 *   • the DISPOSITION slider drives BOTH risk dials when — and only when — the
 *     user moved it off its seed. Evidence for the pairing: the codex collapsed
 *     the two sliders because "risk + speed were near-collinear"
 *     (usePersonaCore.ts header), `applyPreset` seeds the slider FROM the
 *     archetype's `riskTolerance`, and the prose bands ("cautious — verify
 *     before acting" / "bold — act decisively") speak to both verification and
 *     pace. An untouched slider keeps the base's authored dials, so an accepted
 *     archetype round-trips its core exactly.
 *   • conflict style overlays verbatim when chosen; a cleared style is the
 *     absence of an overlay, so the base's authored style stands.
 *   • each selected trait's directive is appended into `principles` (deduped),
 *     in selection order.
 *   • model/effort have NO field on the runtime Core — they stay prose-wired
 *     (see usePersonaCore's "next-leverage follow-up" note) and do not, on
 *     their own, produce a composed Core.
 *
 *  Returns `null` when the codex made no Core-relevant choice, so the caller
 *  leaves the promote stamp's own source untouched.
 */
import type { PersonaCore as CoreProfile } from "@/lib/bindings/PersonaCore";
import { DEFAULT_DISPOSITION, traitById } from "./catalog";
import type { Archetype, PersonaCoreState } from "./types";

/** What the dialogue-cinema layout hands up at Launch: the codex state plus the
 *  resolved archetype card, snapshotted before the surface resets. The matrix
 *  entry holds it until promote, then composes it into `core_profile`. */
export interface PersonaCoreLaunchSnapshot {
  state: PersonaCoreState;
  archetype: Archetype | null;
}

// -- Tolerant narrowing --------------------------------------------------------
// The archetype `persona` blob and the design payload are opaque JSON decided
// far from any TS annotation, so every field is narrowed individually (parse at
// the boundary — never asserted past it).

const clamp01 = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const strArr = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
    : [];

const rec = (v: unknown): Record<string, unknown> | null =>
  // Guarded narrowing: the typeof/null/Array checks above the cast are exactly
  // what `Record<string, unknown>` claims — no field shapes are asserted.
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Neutral Core — mid dials, harmonizer default, mirroring the Life tab's
 *  `emptyCore()` / `parseCoreProfile` defaults (`sub_life/coreProfile.ts`). */
function neutralBase(): CoreProfile {
  return {
    motivation: "",
    stance: "",
    northStarCommitment: "",
    riskTolerance: 0.5,
    speedVsQuality: 0.5,
    conflictStyle: "harmonizer",
    deference: 0.5,
    identity: undefined,
    voice: undefined,
    principles: [],
    constraints: [],
    decisionPrinciples: [],
  };
}

/** Narrow an unknown blob shaped like the 7-dial core (camelCase keys, as the
 *  Rust `PersonaCore` serde contract emits; `decision_principles` accepted too
 *  for v3-authored payloads) into a full `CoreProfile`. `null` for a non-object. */
export function narrowCoreProfile(v: unknown): CoreProfile | null {
  const o = rec(v);
  if (!o) return null;
  return {
    motivation: str(o.motivation),
    stance: str(o.stance),
    northStarCommitment: str(o.northStarCommitment),
    riskTolerance: clamp01(o.riskTolerance, 0.5),
    speedVsQuality: clamp01(o.speedVsQuality, 0.5),
    conflictStyle: str(o.conflictStyle) || "harmonizer",
    deference: clamp01(o.deference, 0.5),
    identity: str(o.identity) || undefined,
    voice: str(o.voice) || undefined,
    principles: strArr(o.principles),
    constraints: strArr(o.constraints),
    decisionPrinciples: strArr(o.decisionPrinciples ?? o.decision_principles),
  };
}

/** Pull the design payload's own `persona.core` out of an agent-IR blob (v3
 *  shape). `null` when the payload is flat / missing / malformed — the caller
 *  then composes over the neutral base. */
export function extractDesignCore(agentIr: unknown): CoreProfile | null {
  return narrowCoreProfile(rec(rec(agentIr)?.persona)?.core);
}

/** The archetype's authored Core: its `persona.core` dials + prose, with the
 *  persona-level identity/voice objects flattened to the Core's prose fields
 *  and the persona-level principle/constraint arrays carried when the core
 *  itself has none (the shipped catalog authors them at the persona level). */
function archetypeBase(archetype: Archetype): CoreProfile {
  const persona = rec(archetype.persona) ?? {};
  const core = narrowCoreProfile(persona.core) ?? neutralBase();
  const identity = rec(persona.identity);
  const voice = rec(persona.voice);
  const identityProse = [str(identity?.role), str(identity?.description)]
    .filter(Boolean)
    .join(". ");
  const voiceProse = str(voice?.style);
  return {
    ...core,
    identity: core.identity ?? (identityProse || undefined),
    voice: core.voice ?? (voiceProse || undefined),
    principles: core.principles.length > 0 ? core.principles : strArr(persona.principles),
    constraints: core.constraints.length > 0 ? core.constraints : strArr(persona.constraints),
    decisionPrinciples:
      core.decisionPrinciples.length > 0
        ? core.decisionPrinciples
        : strArr(persona.decision_principles),
  };
}

/** The value the disposition slider was seeded with: the archetype's authored
 *  `riskTolerance` after `applyPreset`, the codex default otherwise. Anything
 *  else means the user moved it on purpose. */
function sliderSeed(archetype: Archetype | null): number {
  if (!archetype) return DEFAULT_DISPOSITION;
  const core = rec(rec(archetype.persona)?.core);
  return clamp01(core?.riskTolerance, DEFAULT_DISPOSITION);
}

/**
 * Compose the typed runtime Core from the codex snapshot.
 *
 * `designCore` is the fallback base for archetype-less composition (the design
 * payload's own `persona.core`, via {@link extractDesignCore}) so partial codex
 * use never erases LLM-authored prose. Returns `null` when the codex made no
 * Core-relevant choice — model/effort alone do not count, because the runtime
 * Core has no field for them.
 *
 * The result serializes with plain `JSON.stringify`: empty optional prose is
 * `undefined` (omitted on the wire, matching `serializeCoreProfile`'s
 * discipline) and arrays are already trimmed.
 */
export function composeCoreProfile(
  state: PersonaCoreState,
  archetype: Archetype | null,
  designCore?: CoreProfile | null,
): CoreProfile | null {
  const seed = sliderSeed(archetype);
  const sliderMoved = state.disposition !== seed;
  const coreRelevant =
    archetype !== null || state.conflictStyle !== null || state.traits.length > 0 || sliderMoved;
  if (!coreRelevant) return null;

  const base = archetype ? archetypeBase(archetype) : designCore ?? neutralBase();

  const principles = [...base.principles];
  for (const id of state.traits) {
    const directive = traitById(id)?.directive;
    if (directive && !principles.includes(directive)) principles.push(directive);
  }

  const disposition = clamp01(state.disposition, seed);
  return {
    ...base,
    riskTolerance: sliderMoved ? disposition : base.riskTolerance,
    speedVsQuality: sliderMoved ? disposition : base.speedVsQuality,
    conflictStyle: state.conflictStyle ?? base.conflictStyle,
    principles,
  };
}
