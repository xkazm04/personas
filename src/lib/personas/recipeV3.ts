/**
 * Recipe v3 - camelCase re-export of the generated ts-rs bindings, plus the one
 * piece of logic a binding cannot replace: reading the v3 fields off a charter's
 * DB blob.
 *
 * No longer interim. The authoritative shape now lives in `@/lib/bindings/RecipeSpec`
 * and its co-types (generated from the Rust structs, which carry
 * `#[serde(rename_all = "camelCase")]`, so the registry's snake_case JSON
 * (`connector_types`, `recommended_trigger`, `core_action`) arrives here as
 * `connectorTypes`, `recommendedTrigger`, `coreAction`). This module exists so
 * callers keep one import path for the v3 recipe vocabulary under its established
 * names, and so `readV3Fields` - a validating reader over a DB JSON blob, not a
 * type - has somewhere to live. See `scripts/templates/_RECIPE_V3_SPEC.md` for the
 * prose spec the bindings mirror field for field.
 */

import type { RecipeSpec } from '@/lib/bindings/RecipeSpec';
import type { RecipeActivity } from '@/lib/bindings/RecipeActivity';
import type { RecipeConnectorRole } from '@/lib/bindings/RecipeConnectorRole';
import type { RecipeRef } from '@/lib/bindings/RecipeRef';
import type { RecipeDescription } from '@/lib/bindings/RecipeDescription';
import type { CharterConnectorBinding } from '@/lib/bindings/CharterConnectorBinding';
import type { RecipeTriggerRecommendation } from '@/lib/bindings/RecipeTriggerRecommendation';
import type { RecipeExample } from '@/lib/bindings/RecipeExample';
import type { RecipeProvenance } from '@/lib/bindings/RecipeProvenance';
import type { ResponsibilityOutcome } from '@/lib/bindings/ResponsibilityOutcome';
import type { ResponsibilitySpec } from '@/lib/bindings/ResponsibilitySpec';

export type {
  RecipeSpec as RecipeV3Spec,
  RecipeActivity,
  RecipeConnectorRole,
  RecipeRef,
  RecipeDescription,
  CharterConnectorBinding,
  RecipeTriggerRecommendation as RecipeRecommendedTrigger,
  RecipeExample,
  RecipeProvenance,
  ResponsibilityOutcome as RecipeOutcome,
};

/**
 * `observe | decide | act | deliver`. Closed, and the whole vocabulary of a step.
 *
 * Kept as a literal union even though the binding types `RecipeActivity.kind` as
 * plain `string` (ts-rs does not carry Rust's closed enum across the wire as a
 * TS union) - the four-way vocabulary is still real and callers that render by
 * kind (icon, tint, translated label) need it.
 */
export type ActivityKind = 'observe' | 'decide' | 'act' | 'deliver';

/** `event | time | self_paced`. A recommendation; the adopter assigns the real trigger. */
export type RecommendedTriggerKind = 'event' | 'time' | 'self_paced';

/** `seed | maturing | proven`. */
export type RecipeStatus = 'seed' | 'maturing' | 'proven';

export const ACTIVITY_KINDS: readonly ActivityKind[] = ['observe', 'decide', 'act', 'deliver'];

/**
 * The v3 fields a charter's `spec` carries once the backend writes them - the
 * same optional subset `ResponsibilitySpec` declares, picked out by name so this
 * type tracks the binding instead of drifting from it.
 *
 * `ResponsibilitySpec` also carries a `description?: RecipeDescription` field
 * (the recipe's four-line description, copied at adoption) that is NOT picked
 * here and that `readV3Fields` does not read: no current caller renders it, and
 * adding it is outside this reader's kept behaviour. Flagging this rather than
 * quietly adding it - a future caller that needs the description reads it off
 * `ResponsibilitySpec` directly or extends `readV3Fields` deliberately.
 */
export type CharterV3Fields = Pick<
  ResponsibilitySpec,
  'recipeRef' | 'activities' | 'connectorTypes' | 'connectorBindings' | 'dependencies'
>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

const stringList = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(nonEmptyString).map((s) => s.trim());
  // An array that survives as empty is the same as absent for every caller here:
  // both mean "render nothing", and returning `[]` would tempt a caller into
  // rendering an empty block that looks like a real one with no content.
  return out.length ? out : undefined;
};

/**
 * Read the four v3 fields off a charter's `spec`, each independently optional.
 *
 * INVARIANT, and the reason this is a reader rather than a cast: `spec` is a DB
 * JSON blob (`persona_responsibilities.spec`, `TEXT NOT NULL DEFAULT '{}'`). Its
 * runtime shape is decided by whatever wrote the row, never by the binding - a
 * charter minted before v3 has none of these keys, and one written by an older
 * build may have a partial or differently-typed version of any of them. So every
 * field is validated here and returned as `undefined` when it is absent or
 * malformed, and callers render NOTHING for an absent field rather than an empty
 * diagram, a zero-length chip row, or a badge reading `undefined@undefined`.
 *
 * This mirrors the narrowing convention in `@/lib/personas/capabilities`
 * (`asObject`/`asArray`), which is the only other place `spec.*` is assumed.
 */
export function readV3Fields(spec: unknown): CharterV3Fields {
  const s = isRecord(spec) ? spec : null;
  if (!s) return {};

  const out: CharterV3Fields = {};

  const ref = s.recipeRef;
  if (isRecord(ref) && nonEmptyString(ref.slug) && nonEmptyString(ref.version)) {
    out.recipeRef = { slug: ref.slug.trim(), version: ref.version.trim() };
  }

  if (Array.isArray(s.activities)) {
    const acts = s.activities.filter((a): a is RecipeActivity =>
      isRecord(a)
      && nonEmptyString(a.id)
      && nonEmptyString(a.label)
      && ACTIVITY_KINDS.includes(a.kind as ActivityKind));
    // A partially malformed list is reported as what survived rather than dropped
    // whole: an activity the reader can trust is worth showing, and the sequence
    // is a shape, not a contract the UI enforces.
    if (acts.length) out.activities = acts.map((a) => ({ id: a.id, label: a.label, kind: a.kind }));
  }

  const types = stringList(s.connectorTypes);
  // `desktop` is not a connector: every agent has desktop access, so a bound
  // "desktop" row would be a binding to nothing. The registry gate rejects it at
  // the source; this drops it for the charters written before that gate existed.
  if (types) {
    const kept = types.filter((tName) => tName !== 'desktop');
    if (kept.length) out.connectorTypes = kept;
  }

  const deps = stringList(s.dependencies);
  if (deps) out.dependencies = deps;

  if (Array.isArray(s.connectorBindings)) {
    const bindings = s.connectorBindings
      .filter(isRecord)
      .filter((b) => nonEmptyString(b.role) && nonEmptyString(b.connectorType))
      .map((b) => ({
        role: (b.role as string).trim(),
        connectorType: (b.connectorType as string).trim(),
        // An unresolved role is a REAL state, not a defect: adoption could not
        // fill it. It is kept, with `connector` absent, so the UI can say so
        // instead of quietly dropping the row and showing a shorter list.
        connector: nonEmptyString(b.connector) ? b.connector.trim() : undefined,
      }));
    if (bindings.length) out.connectorBindings = bindings;
  }

  return out;
}
