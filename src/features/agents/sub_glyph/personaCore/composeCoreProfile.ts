/** composeManifestSeed — the codex choices, mapped onto MANIFEST SEED PROSE.
 *
 *  Until the agent-manifest rebase this module composed the 7-dial
 *  `PersonaCore` JSON: three numbers (riskTolerance, speedVsQuality,
 *  deference), a conflict-style enum, and five prose fields. **The numbers no
 *  longer reach anything.** Stage B deleted the prompt's dial band tables
 *  (`engine/src/prompt/core_section.rs`: "the manifest's law sections are the
 *  authored word now, and calibrated pseudo-prose from numbers is not"), so a
 *  composed dial was written to `personas.core_profile` and read by nobody.
 *
 *  What `core_profile` is now: the MIRROR of `~/.personas/personas/<id>/manifest.md`.
 *  On first manifest access the Rust seeder (`persona_brain::manifest::ensure`)
 *  reads whatever JSON object it finds there and folds its PROSE keys into the
 *  seeded law sections — identity / motivation / stance / northStarCommitment /
 *  voice / principles / decisionPrinciples into `# Mandate`, constraints into
 *  `# Boundaries` — then overwrites the column with the rendered markdown and
 *  keeps the original beside it as `core.legacy.json`.
 *
 *  So this module's job is to hand that seeder the operator's words. It emits
 *  ONLY the keys the seeder reads. The dial keys are gone rather than zeroed:
 *  writing `riskTolerance: 0.5` would put a number in the persona's permanent
 *  record that nothing consumes and no one authored.
 *
 *  What still composes:
 *   • archetype selected → its authored identity / voice / motivation / stance /
 *     north-star prose plus its principle, constraint and decision-principle
 *     lists (persona-level fields flattened in, exactly as instant adopt stamps
 *     them).
 *   • no archetype → the design payload's own `persona.core` prose, so partial
 *     codex use overlays traits without erasing LLM-authored words.
 *   • each selected trait's directive is appended into `principles` (deduped),
 *     in selection order.
 *   • conflict style, model and effort produce NO seed: the first is carried as
 *     a prose directive in the build intent (`usePersonaCore.launchAugmentation`),
 *     the other two are real backend knobs with their own fields.
 *
 *  Returns `null` when the codex authored no prose, so the caller leaves the
 *  promote stamp's own source untouched.
 */
import { traitById } from "./catalog";
import type { Archetype, PersonaCoreState } from "./types";

/** What the dialogue-cinema layout hands up at Launch: the codex state plus the
 *  resolved archetype card, snapshotted before the surface resets. The matrix
 *  entry holds it until promote, then composes it into `core_profile`. */
export interface PersonaCoreLaunchSnapshot {
  state: PersonaCoreState;
  archetype: Archetype | null;
}

/**
 * The prose the manifest seeder reads out of `personas.core_profile`.
 *
 * Deliberately NOT the `PersonaCore` binding: that type still carries the four
 * dial fields as REQUIRED, and this seed must be able to omit them. The key
 * names are the ones `render_law_seed` looks up, so they are a wire contract
 * with the Rust seeder and not a local convenience shape.
 */
export interface ManifestSeed {
  identity?: string;
  voice?: string;
  motivation?: string;
  stance?: string;
  northStarCommitment?: string;
  principles: string[];
  constraints: string[];
  decisionPrinciples: string[];
}

// -- Tolerant narrowing --------------------------------------------------------
// The archetype `persona` blob and the design payload are opaque JSON decided
// far from any TS annotation, so every field is narrowed individually (parse at
// the boundary — never asserted past it).

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const strArr = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
    : [];

const rec = (v: unknown): Record<string, unknown> | null =>
  // Guarded narrowing: the typeof/null/Array checks above the cast are exactly
  // what `Record<string, unknown>` claims — no field shapes are asserted.
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** An empty seed — every prose field absent, every list empty. */
function emptySeed(): ManifestSeed {
  return { principles: [], constraints: [], decisionPrinciples: [] };
}

/** Does this seed actually say anything? An all-empty seed is not worth
 *  writing over the promote stamp's own source. */
function hasProse(seed: ManifestSeed): boolean {
  return Boolean(
    seed.identity ||
      seed.voice ||
      seed.motivation ||
      seed.stance ||
      seed.northStarCommitment ||
      seed.principles.length ||
      seed.constraints.length ||
      seed.decisionPrinciples.length,
  );
}

/** Narrow an unknown blob shaped like an authored core (camelCase keys, as the
 *  Rust serde contract emits; `decision_principles` accepted too for
 *  v3-authored payloads) into a `ManifestSeed`. `null` for a non-object. */
export function narrowManifestSeed(v: unknown): ManifestSeed | null {
  const o = rec(v);
  if (!o) return null;
  return {
    identity: str(o.identity) || undefined,
    voice: str(o.voice) || undefined,
    motivation: str(o.motivation) || undefined,
    stance: str(o.stance) || undefined,
    northStarCommitment: str(o.northStarCommitment) || undefined,
    principles: strArr(o.principles),
    constraints: strArr(o.constraints),
    decisionPrinciples: strArr(o.decisionPrinciples ?? o.decision_principles),
  };
}

/** Pull the design payload's own `persona.core` prose out of an agent-IR blob
 *  (v3 shape). `null` when the payload is flat / missing / malformed — the
 *  caller then composes over an empty seed. */
export function extractDesignSeed(agentIr: unknown): ManifestSeed | null {
  return narrowManifestSeed(rec(rec(agentIr)?.persona)?.core);
}

/** The archetype's authored prose: its `persona.core` fields, with the
 *  persona-level identity/voice objects flattened to prose and the
 *  persona-level principle/constraint arrays carried when the core itself has
 *  none (the shipped catalog authors them at the persona level). */
function archetypeSeed(archetype: Archetype): ManifestSeed {
  const persona = rec(archetype.persona) ?? {};
  const core = narrowManifestSeed(persona.core) ?? emptySeed();
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

/**
 * Compose the manifest seed prose from the codex snapshot.
 *
 * `designSeed` is the fallback base for archetype-less composition (the design
 * payload's own `persona.core`, via {@link extractDesignSeed}) so partial codex
 * use never erases LLM-authored prose. Returns `null` when the codex authored
 * nothing — an untouched codex, or one where only model/effort/conflict style
 * were set, none of which put a word in the manifest.
 *
 * The result serializes with plain `JSON.stringify`: empty optional prose is
 * `undefined` (omitted on the wire) and arrays are already trimmed.
 */
export function composeManifestSeed(
  state: PersonaCoreState,
  archetype: Archetype | null,
  designSeed?: ManifestSeed | null,
): ManifestSeed | null {
  if (archetype === null && state.traits.length === 0) return null;

  const base = archetype ? archetypeSeed(archetype) : designSeed ?? emptySeed();

  const principles = [...base.principles];
  for (const id of state.traits) {
    const directive = traitById(id)?.directive;
    if (directive && !principles.includes(directive)) principles.push(directive);
  }

  const seed: ManifestSeed = { ...base, principles };
  return hasProse(seed) ? seed : null;
}
