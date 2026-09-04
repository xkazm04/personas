import type { PersonaResponsibility } from '@/lib/bindings/PersonaResponsibility';
import type { ResponsibilitySpec } from '@/lib/bindings/ResponsibilitySpec';
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
 */
export function mergeSpec(base: ResponsibilitySpec, patch: Partial<ResponsibilitySpec>): ResponsibilitySpec {
  return { ...base, ...patch };
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
