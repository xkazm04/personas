/**
 * _v3_normalize - the two corpus-wide passes the v2 -> v3 transform runs over
 * `input_schema`, as PURE functions with no filesystem or corpus coupling.
 *
 * This is a module, not a script. It lives beside the transform rather than
 * inside it for one reason: both passes are rules about the corpus that outlive
 * any single migration run, and a rule buried in a one-shot transform is a rule
 * that cannot be tested, re-run, or reused by the next pass over the same
 * corpus. The transform imports it:
 *
 *   import { normalizeInputSchema, vendorEnumNotes, loadConnectorIndex }
 *     from './_v3_normalize.mjs';
 *
 * The `_` prefix keeps it out of the template walk in `src-tauri/build.rs`,
 * which skips `_`-prefixed entries under `scripts/templates/`.
 *
 * Tests: `node --test scripts/templates/_v3_normalize.test.mjs`. Vitest does not
 * see this file (`vitest.config.ts` includes only `src/**`), so the runtime's own
 * runner is the one that pins it.
 *
 * Zero dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------- pass 1: typography

/**
 * Characters the house rule replaces, each with the ASCII a reader's eye already
 * substitutes. Deliberately NOT a general "de-unicode" sweep: accented letters,
 * non-Latin scripts and currency symbols are content and stay untouched.
 */
const PROSE_SUBSTITUTIONS = [
  // Long dashes. Both forms collapse to a spaced hyphen, whether or not the
  // source spaced them: "a - b" is the house form and "a-b" reads as a compound.
  [/\s*[—–]\s*/g, ' - '],
  // The other dashes in the U+2010..U+2015 block, which are hyphens with
  // opinions. These are NOT spaced: a non-breaking hyphen inside a word is a
  // hyphen, and spacing it would break the word.
  [/[‐‑‒―]/g, '-'],
  // Arrows.
  [/\s*↔\s*/g, ' <-> '],
  [/\s*⇒\s*/g, ' => '],
  [/\s*⇐\s*/g, ' <= '],
  [/\s*→\s*/g, ' -> '],
  [/\s*←\s*/g, ' <- '],
  // Ellipsis.
  [/…/g, '...'],
];

/**
 * Rewrite one prose string into the house typography. Pure, idempotent, and a
 * no-op on a string that is already ASCII in these respects.
 *
 * Leading and trailing whitespace is preserved as-is rather than trimmed: this
 * function's job is characters, not layout, and a transform that also trimmed
 * would make two unrelated changes under one name.
 */
export function normalizeProse(value) {
  if (typeof value !== 'string') return value;
  let out = value;
  for (const [re, to] of PROSE_SUBSTITUTIONS) out = out.replace(re, to);
  // Untouched in, untouched out. The cleanup below must never run on a string no
  // substitution fired on, or the pass silently starts reformatting whitespace
  // the author wrote - which is a second change under one name.
  if (out === value) return value;
  // A spaced substitution can produce a double space where the source already had
  // one beside the character it replaced, and can push a space against an edge the
  // source had none at. Repair BOTH, but only in the interior and only at edges
  // the substitution itself created: the original leading and trailing whitespace
  // is restored verbatim.
  const lead = value.match(/^\s*/)[0];
  const trail = value.match(/\s*$/)[0];
  out = out.trim().replace(/ {2,}/g, ' ');
  return `${lead}${out}${trail}`;
}

/**
 * Apply the typography pass to `input_schema[].description` AND NOWHERE ELSE.
 *
 * Names, types, defaults, options, min and max stay byte-identical. That
 * restriction is the whole point: an option value is an identifier the runtime
 * compares, and rewriting a character inside one silently changes which branch a
 * recipe takes. Only the human-facing prose is rewritten.
 *
 * Returns a NEW array; the input is never mutated. A non-array input is returned
 * unchanged so a caller can pass a missing or malformed schema through without
 * a guard.
 */
export function normalizeInputSchema(inputSchema) {
  if (!Array.isArray(inputSchema)) return inputSchema;
  return inputSchema.map((field) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) return field;
    if (typeof field.description !== 'string') return field;
    const next = normalizeProse(field.description);
    if (next === field.description) return field;
    return { ...field, description: next };
  });
}

/** How many fields the typography pass would actually rewrite. For a run summary. */
export function countProseRewrites(inputSchema) {
  if (!Array.isArray(inputSchema)) return 0;
  return inputSchema.filter(
    (f) => f && typeof f === 'object' && typeof f.description === 'string'
      && normalizeProse(f.description) !== f.description,
  ).length;
}

// ------------------------------------------------- pass 2: vendor names in enums

/**
 * v3 removed vendor names from `connector_types`, which now carry categories.
 * They survive in the KNOBS: a `report_delivery` enum whose options are
 * `notion | email | slack` still names two vendors and a category.
 *
 * This pass REPORTS them and changes nothing. Rewriting an enum option would
 * change a recipe's behaviour, and the decision about which of these is a real
 * vendor binding and which is an ordinary English word belongs to a human
 * reading the list.
 */

/** Every name a connector answers to: its id, the id without `builtin-`, its `name`. */
export function connectorAliases(def) {
  const out = new Set();
  const add = (v) => { if (typeof v === 'string' && v.trim()) out.add(v.trim().toLowerCase()); };
  add(def?.id);
  if (typeof def?.id === 'string' && def.id.startsWith('builtin-')) add(def.id.slice('builtin-'.length));
  add(def?.name);
  return [...out];
}

/**
 * Read `scripts/connectors/builtin/*.json` into an alias -> connector id map.
 *
 * The one impure function here, kept separate from the matcher so the matcher can
 * be tested against a hand-built index with no filesystem at all.
 */
export function loadConnectorIndex(dir) {
  const index = new Map();
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    let def;
    try { def = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch { continue; }
    const id = typeof def?.id === 'string' ? def.id : file.replace(/\.json$/, '');
    for (const alias of connectorAliases({ ...def, id })) {
      if (!index.has(alias)) index.set(alias, id);
    }
  }
  return index;
}

/**
 * Enum options that name a connector, as notes. Pure: the index is passed in.
 *
 * Matching is EXACT on a lowercased, trimmed option value. Substring matching was
 * considered and rejected: `email` is a connector alias and also the ordinary
 * word in "email digest", and a matcher that fires on both produces a list nobody
 * reads. An exact match on a whole option value is the signal worth reporting.
 *
 * Returns `[]` when there is nothing to report, so a caller can always spread it
 * into `transform_notes` without a guard.
 */
export function vendorEnumNotes(inputSchema, connectorIndex) {
  if (!Array.isArray(inputSchema)) return [];
  const notes = [];
  for (const field of inputSchema) {
    if (!field || typeof field !== 'object' || !Array.isArray(field.options)) continue;
    const name = typeof field.name === 'string' ? field.name : '(unnamed field)';
    for (const option of field.options) {
      const value = typeof option === 'string' ? option
        : (option && typeof option === 'object' && typeof option.value === 'string' ? option.value : null);
      if (!value) continue;
      const hit = connectorIndex.get(value.trim().toLowerCase());
      if (!hit) continue;
      notes.push({
        kind: 'vendor-in-enum',
        field: name,
        option: value,
        connector: hit,
        note: `input_schema.${name} enum option "${value}" names connector ${hit}. v3 removed vendor names from connector_types; this one survives in a knob. Reported, not changed.`,
      });
    }
  }
  return notes;
}

/** One line per note, for the transform's stdout summary. */
export function formatVendorEnumNotes(recipeSlug, notes) {
  return notes.map((n) => `  ${recipeSlug}: input_schema.${n.field} option "${n.option}" -> connector ${n.connector}`);
}

// ------------------------------------------- pass 3: connector_ref knobs vs connector_types

/**
 * v2 input types that ARE a connector binding wearing a knob's clothes. Measured
 * over the corpus on 2026-09-06: 12 `connector_ref` fields and 1
 * `source_definition`, across 13 recipes in three lanes.
 */
export const CONNECTOR_REF_TYPES = new Set(['connector_ref', 'source_definition']);

/**
 * Reconcile the two binding seams down to one.
 *
 * A `connector_ref` knob asks the adopter "which connector?" and so does
 * `credential_bindings`, which is what `connector_types` resolves into at
 * adoption. Two seams for one question can DISAGREE: the adopter answers twice
 * and nothing reconciles the answers, so a run reads whichever the code path
 * happened to consult. v3 keeps `credential_bindings` and drops the knob.
 *
 * The knob is removed from `input_schema` and reported. A type is DERIVED from it
 * only where the source evidences one - an explicit `connector_type`/`category`,
 * or the categories of the concrete connector the knob names - and only where the
 * recipe does not already declare `connector_types`. Nothing is ever invented: a
 * knob that names no resolvable type in a recipe with no types is reported as
 * `dropped-unresolved`, which is a question for a human, not a default to guess.
 *
 * Pure. `categoriesOf(connectorName) -> string[]` and the known-category set are
 * passed in, so this is testable with no catalog on disk.
 *
 * Returns `{ inputSchema, connectorTypes, notes }` and never mutates its input.
 */
/**
 * v2 connector ids whose catalog categories must NOT be taken at face value.
 * Measured against `scripts/connectors/builtin/*.json` on 2026-09-06.
 *
 * - `codebase` / `codebases` carry `["development","source_control","desktop"]`.
 *   Deriving all of them WIDENS the recipe: `source_control` also resolves to
 *   GitHub and GitLab, which is a hosted service, not the operator's own
 *   registered local project. The type is recorded as `development` and the
 *   original id is kept as an EXAMPLE, which is exactly what v3 does with every
 *   other demoted connector id.
 * - `desktop_browser` carries `["browser_automation","desktop"]`. `desktop` is a
 *   real catalog category (5 connectors) that the spec bans as a recipe type, so
 *   the useful half is `browser_automation`.
 * - `desktop` and `desktop_terminal` map to nothing at all: every agent has
 *   desktop access, so a type derived from them binds to nothing.
 *
 * `example` is the connector id to carry into `examples[]`, where concrete
 * knowledge lives and is allowed to.
 */
export const V2_CONNECTOR_TYPE_OVERRIDES = new Map([
  ['codebase', { types: ['development'], example: 'codebase' }],
  ['codebases', { types: ['development'], example: 'codebases' }],
  ['desktop_browser', { types: ['browser_automation'], example: 'desktop_browser' }],
  ['desktop', { types: [], example: null }],
  ['desktop_terminal', { types: [], example: null }],
]);

export function reconcileConnectorRefKnobs(recipe, { categoriesOf, knownCategories }) {
  const schema = Array.isArray(recipe?.input_schema) ? recipe.input_schema : null;
  const declared = Array.isArray(recipe?.connector_types)
    ? recipe.connector_types.filter((c) => typeof c === 'string' && c.trim())
    : [];
  if (!schema) return { inputSchema: recipe?.input_schema, connectorTypes: declared, notes: [] };

  const known = (c) => typeof c === 'string' && (!knownCategories || knownCategories.has(c));
  const kept = [];
  const notes = [];
  const derived = new Set();

  for (const field of schema) {
    if (!field || typeof field !== 'object' || !CONNECTOR_REF_TYPES.has(field.type)) {
      kept.push(field);
      continue;
    }
    const name = typeof field.name === 'string' ? field.name : '(unnamed field)';
    const connector = typeof field.connector === 'string' ? field.connector : null;

    const fromField = [field.connector_type, field.category].filter(known);
    // An override wins over the catalog: taking those ids' categories at face
    // value widens the recipe past what it meant. See V2_CONNECTOR_TYPE_OVERRIDES.
    const override = connector ? V2_CONNECTOR_TYPE_OVERRIDES.get(connector) : undefined;
    // `desktop` is a real catalog category and a banned recipe type: every agent
    // has desktop access, so deriving it would mint a binding to nothing.
    const fromCatalog = override
      ? override.types.filter(known)
      : (connector ? (categoriesOf?.(connector) ?? []).filter((c) => known(c) && c !== 'desktop') : []);
    const candidates = [...new Set([...fromField, ...fromCatalog])].sort();
    const example = override?.example ?? null;

    let action;
    if (declared.length > 0) {
      // The recipe already expresses the binding as a type. The knob is pure
      // duplication and its removal loses nothing.
      action = 'dropped-duplicate';
    } else if (candidates.length > 0) {
      for (const c of candidates) derived.add(c);
      action = 'dropped-and-derived';
    } else {
      action = 'dropped-unresolved';
    }

    notes.push({
      kind: 'connector-ref-knob',
      field: name,
      type: field.type,
      connector,
      derivedTypes: action === 'dropped-and-derived' ? candidates : [],
      // The concrete id the recipe should keep as an `examples[]` entry, so
      // demoting a connector id to a type does not lose which connector it was.
      keepAsExample: example,
      action,
      note: action === 'dropped-unresolved'
        ? `input_schema.${name} (type ${field.type}) was a second binding seam and is dropped, but no connector type could be derived from it${connector ? ` (connector "${connector}" is not in the catalog)` : ' (it names no connector)'}. This recipe declares no connector_types either: a human must supply one.`
        : `input_schema.${name} (type ${field.type}) was a second binding seam and is dropped. Adoption binds through credential_bindings from connector_types${action === 'dropped-and-derived' ? `, derived here as [${candidates.join(', ')}]` : ', which this recipe already declares'}.`,
    });
  }

  const connectorTypes = declared.length > 0
    ? declared
    : [...derived].sort();

  return { inputSchema: kept, connectorTypes, notes };
}

// ------------------------------- pass 4: connector types that are not catalog categories

/**
 * v2 connector IDS that reached `connector_types` and have no catalog file and so
 * no category at all. Measured 2026-09-06: `desktop_terminal` is the whole set -
 * it is a tool the agent runs, not a connector it binds, which is why it never got
 * a catalog entry and why the right destination for it is `dependencies`.
 *
 * Overridable by the caller. A hard-coded list that cannot be extended without a
 * code change is how the next one of these goes unnoticed.
 */
export const UNCATALOGED_V2_CONNECTOR_IDS = new Set(['desktop_terminal']);

/**
 * Sort `connector_types` into the ones the catalog knows, the ones that are really
 * tools, and the ones nobody recognizes.
 *
 * The asymmetry here is deliberate and it is the point. An unrecognized value is
 * KEPT, not dropped: a reviewer may have added a type on a superseding
 * responsibility's authority, or the catalog may simply not have that connector
 * yet, and a mechanical pass that assumes the type list only ever shrinks would
 * silently delete a human's decision. Only a value on the demote list - a known v2
 * connector id with no catalog entry - is moved, and it moves to `dependencies`
 * rather than vanishing.
 *
 * Pure. Returns `{ connectorTypes, dependencies, notes }`, never mutates.
 */
export function demoteUncatalogedTypes(recipe, { knownCategories, demoteIds = UNCATALOGED_V2_CONNECTOR_IDS } = {}) {
  const types = Array.isArray(recipe?.connector_types)
    ? recipe.connector_types.filter((c) => typeof c === 'string' && c.trim()).map((c) => c.trim())
    : [];
  const deps = Array.isArray(recipe?.dependencies)
    ? recipe.dependencies.filter((d) => typeof d === 'string' && d.trim()).map((d) => d.trim())
    : [];

  const keptTypes = [];
  const newDeps = [];
  const notes = [];

  for (const type of types) {
    if (knownCategories?.has(type)) { keptTypes.push(type); continue; }
    if (demoteIds.has(type)) {
      if (!deps.includes(type) && !newDeps.includes(type)) newDeps.push(type);
      notes.push({
        kind: 'type-demoted-to-dependency',
        type,
        action: 'demoted',
        note: `connector_types "${type}" is a v2 connector id with no catalog entry and no category. It is a tool the agent runs, not a connector it binds, so it moves to dependencies.`,
      });
      continue;
    }
    // Kept. Reported so a human can confirm it, never removed.
    keptTypes.push(type);
    notes.push({
      kind: 'type-not-in-catalog',
      type,
      action: 'kept',
      note: `connector_types "${type}" is not a category in the connector catalog. KEPT, not dropped: a reviewer may have added it on a superseding responsibility's authority, or the catalog may not carry that connector yet. Confirm it.`,
    });
  }

  return {
    connectorTypes: [...new Set(keptTypes)],
    dependencies: [...deps, ...newDeps],
    notes,
  };
}

/** One line per note, for the transform's stdout summary. */
export function formatTypeNotes(recipeSlug, notes) {
  return notes.map((n) => `  ${recipeSlug}: connector_types "${n.type}" -> ${n.action === 'demoted' ? 'dependencies' : 'KEPT, unrecognized, confirm'}`);
}

/** One line per note, for the transform's stdout summary. */
export function formatConnectorRefNotes(recipeSlug, notes) {
  return notes.map((n) => {
    const tail = n.action === 'dropped-and-derived' ? ` -> connector_types [${n.derivedTypes.join(', ')}]`
      : n.action === 'dropped-unresolved' ? ' -> UNRESOLVED, needs a human'
        : ' -> already declared';
    return `  ${recipeSlug}: dropped input_schema.${n.field} (${n.type})${tail}`;
  });
}

// ------------------ pass 5: connector ids and cadences surviving inside knob names

/**
 * Cadence words that encode a schedule. v3 moved the schedule to the charter, so
 * a cadence inside a knob name or default is a binding the recipe still carries
 * where nobody looks for it.
 */
const CADENCE_RE = /\b(daily|weekly|hourly|monthly|nightly|per\s+(?:day|week|month|hour)|every\s+\d+\s*\w*)\b/i;

/** Split a knob name into the words a connector id could hide in: `buffer_queue` -> buffer, queue. */
const nameWords = (name) => String(name ?? '').split(/[^a-z0-9]+/i).filter(Boolean).map((w) => w.toLowerCase());

/**
 * Report connector ids and cadences that survive inside `input_schema` knob NAMES,
 * descriptions and defaults, even where the recipe itself is now agnostic.
 *
 * REPORT ONLY, and the reason is load-bearing: a knob name is a substitution key.
 * Renaming `buffer_queue` breaks `{{param.buffer_queue}}` in every persona prompt
 * that already carries it, silently, at run time. So this pass never renames. It
 * lists, and Phase D decides with the persona-prompt impact in view.
 *
 * Pure. The connector index is passed in.
 */
export function survivingBindingNotes(inputSchema, connectorIndex) {
  if (!Array.isArray(inputSchema)) return [];
  const notes = [];
  for (const field of inputSchema) {
    if (!field || typeof field !== 'object') continue;
    const name = typeof field.name === 'string' ? field.name : '(unnamed field)';
    const description = typeof field.description === 'string' ? field.description : '';
    const dflt = typeof field.default === 'string' ? field.default : '';

    // A connector id inside the NAME: matched word by word, because a knob name is
    // an identifier and `buffer_queue` is two words, not a substring haystack.
    for (const word of new Set(nameWords(name))) {
      const hit = connectorIndex.get(word);
      if (!hit) continue;
      notes.push({
        kind: 'connector-in-knob-name', where: 'name', field: name, match: word, connector: hit,
        note: `knob:${name}: the name carries connector id "${word}" (${hit}) though the recipe is connector-agnostic. NOT renamed: the name is a {{param.${name}}} substitution key and renaming it breaks every persona prompt already carrying it.`,
      });
    }

    // A connector id inside the DESCRIPTION: whole-word, same reason the enum pass
    // refuses substrings - "email digest" is prose, not a binding.
    for (const [alias, id] of connectorIndex) {
      if (alias.length < 4) continue;
      const escaped = alias.replace(/[.*+?^${}()|[\]\\-]/g, (m) => `\\${m}`);
      const re = new RegExp(`\\b${escaped}\\b`, 'i');
      if (!re.test(description)) continue;
      notes.push({
        kind: 'connector-in-knob-description', where: 'description', field: name, match: alias, connector: id,
        note: `knob:${name}: the description names connector "${alias}" (${id}) though the recipe is connector-agnostic. Prose only; safe to rewrite in Phase D.`,
      });
      break; // one note per field is enough to make it findable
    }

    // A cadence anywhere a reader or a default would pick it up. The NAME is
    // matched over its words, not raw: `_` is a word character to a regex, so
    // `\bweekly\b` does not fire on `weekly_run` - and `weekly_run` is exactly
    // the shape a knob name takes.
    const nameText = nameWords(name).join(' ');
    const where = CADENCE_RE.test(nameText) ? 'name' : (CADENCE_RE.test(dflt) ? 'default' : (CADENCE_RE.test(description) ? 'description' : null));
    const cadence = where && CADENCE_RE.exec({ name: nameText, default: dflt, description }[where]);
    if (cadence) {
      notes.push({
        kind: 'cadence-in-knob', where,
        field: name, match: cadence[0], connector: null,
        note: `knob:${name}: carries cadence "${cadence[0]}". v3 moved the schedule to the charter's trigger; a cadence surviving in a knob is a binding where nobody looks for it. Reported, not changed.`,
      });
    }
  }
  return notes;
}

/** One line per note, for the transform's stdout summary. */
export function formatSurvivingBindingNotes(recipeSlug, notes) {
  return notes.map((n) => `  ${recipeSlug}: knob:${n.field} ${n.where} carries "${n.match}"${n.connector ? ` -> ${n.connector}` : ' (cadence)'}`);
}
