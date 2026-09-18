import type { PersonaResponsibility } from '@/lib/bindings/PersonaResponsibility';
import type { ResponsibilitySpec } from '@/lib/bindings/ResponsibilitySpec';
import type { ResourceProfile } from '@/lib/bindings/ResourceProfile';
import type { MachineLoad } from '@/lib/bindings/MachineLoad';
import type { GpuClass } from '@/lib/bindings/GpuClass';
import type { Difficulty } from '@/lib/bindings/Difficulty';
import type { EffortBand } from '@/lib/bindings/EffortBand';
import type { JsonValue } from '@/lib/bindings/serde_json/JsonValue';
import type { UseCaseInputField } from '@/lib/types/frontendTypes';
import { specInputFields, specParameterValues } from '@/lib/personas/capabilities';

/**
 * Charter `spec` write helpers.
 *
 * `update_persona_responsibility` REPLACES the whole `spec` column (the wire
 * field is `ResponsibilitySpec | null`, not a patch), so every editor here
 * merges onto the charter's current spec and sends the whole thing back. A
 * naive `{ spec: { memoryPolicy } }` would silently erase recipe provenance,
 * fixtures and the input schema.
 *
 * `resourceProfile` is the one key that does NOT ride along. The update door
 * keeps the stored profile when a spec arrives without one
 * (`reconcile_operator_profile`), and treats any profile that differs from the
 * stored one as an OPERATOR write. Echoing `base.resourceProfile` from an
 * unrelated editor would therefore race the persona: a self-declaration landing
 * between this editor's load and its save would be overwritten by the stale
 * copy and re-attributed to the operator. So the profile is sent only when the
 * patch itself carries it — i.e. only from the resource-profile card.
 */
export function mergeSpec(base: ResponsibilitySpec, patch: Partial<ResponsibilitySpec>): ResponsibilitySpec {
  const { resourceProfile: _stored, ...rest } = base;
  return { ...rest, ...patch };
}

/**
 * Structural equality for the dirty-checks in the per-dimension editors.
 *
 * Deliberately NOT `JSON.stringify(a) === JSON.stringify(b)`: key order is
 * insertion order in JS and survives a `JSON.parse` round trip, so a value
 * that came back from the update door compares UNEQUAL to the object literal
 * the editor built from the same fields — which would leave Save armed
 * forever after a successful save.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameValue(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    for (const k of keys) if (!sameValue(ao[k], bo[k])) return false;
    return true;
  }
  return false;
}

/** The charter's declared `{{param.*}}` knobs. */
export function charterInputFields(r: PersonaResponsibility): UseCaseInputField[] {
  return specInputFields(r.spec);
}

/**
 * The charter's saved parameter VALUES.
 *
 * They live in `spec.sampleInput`, not in the persona-wide `parameters`
 * column: `sync_capability_parameters` derives that column from the persona's
 * adopted recipes and would overwrite anything written per charter, and its
 * shape is one flat bag for the whole persona — two charters that both declare
 * a `channel` knob would collide. `sampleInput` is already the per-capability
 * invocation payload the run path reads, so storing the values there means the
 * editor and the runtime agree without a schema change.
 */
export function charterParameterValues(r: PersonaResponsibility): Record<string, unknown> {
  return specParameterValues(r.spec);
}

/**
 * Coerce one editor value to the declared field type before persisting.
 *
 * Keyed by the declared type rather than an `if (field.type === ...)` chain, so
 * the vocabulary lives in exactly one place (`CAPABILITY_FIELD_TYPES`) and a
 * kind added there is a compile error here until it is handled.
 */
const PARAMETER_COERCERS: Record<UseCaseInputField['type'], (raw: string | boolean) => JsonValue> = {
  boolean: (raw) => raw === true || raw === 'true',
  number: (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  },
  text: (raw) => (typeof raw === 'string' ? raw : String(raw)),
  select: (raw) => (typeof raw === 'string' ? raw : String(raw)),
};

export function coerceParameterValue(field: UseCaseInputField, raw: string | boolean): JsonValue {
  return PARAMETER_COERCERS[field.type](raw);
}

/** A spec carrying the new parameter values, ready for the update door. */
export function specWithParameterValues(
  spec: ResponsibilitySpec,
  values: Record<string, JsonValue>,
): ResponsibilitySpec {
  return mergeSpec(spec, { sampleInput: values });
}

/** Read `spec.memoryPolicy.enabled` — the only field the memory editor writes. */
export function memoryPolicyEnabled(spec: ResponsibilitySpec): boolean {
  const p = spec.memoryPolicy;
  return !!p && typeof p === 'object' && !Array.isArray(p) && p.enabled === true;
}

/** Read `spec.reviewPolicy.mode`, or `''` when review is unconfigured. */
export function reviewPolicyMode(spec: ResponsibilitySpec): string {
  const p = spec.reviewPolicy;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return '';
  return typeof p.mode === 'string' ? p.mode : '';
}

/** Review modes the charter editor offers. `''` clears the policy. */
export const REVIEW_MODES = ['', 'always', 'auto_triage', 'never'] as const;

/** `spec.eventSubscriptions` as an editable string list (see the read-model's
 *  `specEventSubscriptions` for the same lenient parse on the display side). */
export function eventSubscriptionNames(spec: ResponsibilitySpec): string[] {
  const subs = spec.eventSubscriptions;
  if (!Array.isArray(subs)) return [];
  return subs
    .map((row) => {
      if (typeof row === 'string') return row;
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        const name = row.eventType ?? row.event_type ?? row.type ?? row.name;
        return typeof name === 'string' ? name : null;
      }
      return null;
    })
    .filter((x): x is string => !!x);
}

/** Rewrite `spec.eventSubscriptions` from the editable name list, preserving
 *  any per-row config the original objects carried. */
export function specWithEventSubscriptions(spec: ResponsibilitySpec, names: string[]): ResponsibilitySpec {
  const previous = Array.isArray(spec.eventSubscriptions) ? spec.eventSubscriptions : [];
  const byName = new Map<string, JsonValue>();
  for (const row of previous) {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      const name = row.eventType ?? row.event_type ?? row.type ?? row.name;
      if (typeof name === 'string') byName.set(name, row);
    }
  }
  const next: JsonValue = names.map((n) => byName.get(n) ?? { eventType: n });
  return mergeSpec(spec, { eventSubscriptions: next });
}

// -- Resource profile -------------------------------------------------------

/** The four run-cost tags plus the operator's lock: what the card edits. */
export interface ResourceProfileDraft {
  machine: MachineLoad;
  gpu: GpuClass;
  difficulty: Difficulty;
  effort: EffortBand;
  pinned: boolean;
}

/** Mirrors `ResourceProfile::default` (core/models/responsibility.rs): what an
 *  untagged charter is charged as at admission. */
export const DEFAULT_PROFILE_DRAFT: ResourceProfileDraft = {
  machine: 'light',
  gpu: 'none',
  difficulty: 'standard',
  effort: 'm',
  pinned: false,
};

export const MACHINE_LOADS = ['light', 'moderate', 'heavy', 'exclusive'] as const satisfies readonly MachineLoad[];
export const GPU_CLASSES = ['none', 'shared', 'exclusive'] as const satisfies readonly GpuClass[];
export const DIFFICULTIES = ['light', 'standard', 'hard'] as const satisfies readonly Difficulty[];
export const EFFORT_BANDS = ['s', 'm', 'l', 'xl'] as const satisfies readonly EffortBand[];

/** `MachineLoad::units()` — admission units against the machine budget. */
export const MACHINE_UNITS: Record<MachineLoad, number> = { light: 1, moderate: 2, heavy: 4, exclusive: 8 };
/** `EffortBand::units()` — admission units against the plan budget. */
export const EFFORT_UNITS: Record<EffortBand, number> = { s: 1, m: 2, l: 4, xl: 8 };
/** `EffortBand::from_total_tokens` band edges: [lower, upper) in total tokens. */
export const EFFORT_TOKEN_RANGE: Record<EffortBand, { from: number | null; to: number | null }> = {
  s: { from: null, to: 50_000 },
  m: { from: 50_000, to: 250_000 },
  l: { from: 250_000, to: 1_000_000 },
  xl: { from: 1_000_000, to: null },
};
/** `route_for_difficulty` (db/model_routing.rs): the tier a DECLARED difficulty
 *  routes to when no override, persona model or routing rule wins first. */
export const DIFFICULTY_ROUTE: Record<Difficulty, { model: 'haiku' | 'sonnet' | 'opus'; effort: 'low' | 'medium' | 'high' }> = {
  light: { model: 'haiku', effort: 'low' },
  standard: { model: 'sonnet', effort: 'medium' },
  hard: { model: 'opus', effort: 'high' },
};

/** Anthropic model-tier brand names — never translated (i18n.md, "What NOT to translate"). */
export const MODEL_TIER_NAMES = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' } as const;
/** Size codes for the effort bands — identifiers like a T-shirt size, not prose. */
export const EFFORT_BAND_CODES: Record<EffortBand, string> = { s: 'S', m: 'M', l: 'L', xl: 'XL' };

const oneOf = <T extends string>(allowed: readonly T[], v: unknown, fallback: T): T =>
  allowed.find((a) => a === v) ?? fallback;

/**
 * The editable view of `spec.resourceProfile`, PARSED rather than asserted:
 * the spec is a DB-stored JSON blob a persona's model can write, so each tag is
 * checked against its vocabulary and an unknown value degrades to the default
 * instead of reaching a control that has no option for it.
 */
export function profileDraftOf(spec: ResponsibilitySpec): ResourceProfileDraft {
  const p: Partial<ResourceProfile> | undefined = spec.resourceProfile ?? undefined;
  if (!p) return DEFAULT_PROFILE_DRAFT;
  return {
    machine: oneOf(MACHINE_LOADS, p.machine, DEFAULT_PROFILE_DRAFT.machine),
    gpu: oneOf(GPU_CLASSES, p.gpu, DEFAULT_PROFILE_DRAFT.gpu),
    difficulty: oneOf(DIFFICULTIES, p.difficulty, DEFAULT_PROFILE_DRAFT.difficulty),
    effort: oneOf(EFFORT_BANDS, p.effort, DEFAULT_PROFILE_DRAFT.effort),
    pinned: p.pinned === true,
  };
}

export function sameProfileTags(a: ResourceProfileDraft, b: ResourceProfileDraft): boolean {
  return a.machine === b.machine && a.gpu === b.gpu && a.difficulty === b.difficulty && a.effort === b.effort;
}

/**
 * A spec carrying the operator's profile edit, ready for the update door.
 *
 * `source` and `declaredAt` are NOT authoritative here: the door stamps both
 * (`merge_profile` as `ProfileWriter::Operator`) before validating, so the
 * values below only satisfy the wire shape. The rationale is kept when the
 * tags are untouched (a pure pin/unpin still describes the same run) and
 * dropped when they changed — the persona's reasoning no longer explains them.
 */
export function specWithResourceProfile(spec: ResponsibilitySpec, draft: ResourceProfileDraft): ResponsibilitySpec {
  const stored = spec.resourceProfile;
  const keepRationale = !!stored && sameProfileTags(profileDraftOf(spec), draft);
  const resourceProfile: ResourceProfile = {
    machine: draft.machine,
    gpu: draft.gpu,
    difficulty: draft.difficulty,
    effort: draft.effort,
    pinned: draft.pinned,
    rationale: keepRationale ? (stored.rationale ?? null) : null,
    source: 'operator',
    declaredAt: null,
  };
  return mergeSpec(spec, { resourceProfile });
}
