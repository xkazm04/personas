#!/usr/bin/env node
/**
 * Recipe v3 — one-way transform of the recipe seed bundle's payloads from
 * "responsibility charter JSON" (v2) to "recipe JSON" (v3).
 *
 * Contract: `scripts/templates/_RECIPE_V3_SPEC.md`. Sibling and predecessor:
 * `transform-recipes-to-responsibilities.mjs` (v1 -> v2), whose shape and
 * refuse-on-rerun discipline this mirrors.
 *
 * WHAT IT REWRITES
 * `scripts/templates/_recipe_seeds.json` in place (override with `--seeds`):
 *   - the bundle's `version` goes 2 -> 3 (the compiled-in reader,
 *     `src-tauri/src/engine/recipe_seed.rs`, pins the accepted range and must
 *     move in the same change);
 *   - every `recipes[].prompt_template` becomes a v3 `RecipeSpec` payload;
 *   - EVERY OTHER top-level seed field (`id`, `source_template_id`,
 *     `source_use_case_id`, `source_version`, `name`, `description`,
 *     `category`, `tags`, ...) is byte-identical, so the templates'
 *     `recipe_ref` bindings survive unchanged.
 *
 * TWO SOURCES OF CONTENT, and the difference is the point
 *
 *   1. `--overlay <dir>` — reviewed v3 objects, written by the item-by-item
 *      review lanes as `v3_L*.json`. For any recipe id present there, the
 *      REVIEWED object is used verbatim (normalized to the camelCase wire
 *      shape). This is the real content.
 *   2. everything else gets a MECHANICAL best-effort mapping and is stamped
 *      `"status": "seed"` + `"reviewNotes": "mechanical"`. A mechanical recipe
 *      is deliberately incomplete: it carries NO activities and NO
 *      personalization needs, because inventing them is fabrication and the
 *      contract would rather have an honest gap than a plausible one. It will
 *      not pass `RecipeSpec::validate` until a human or a review lane
 *      finishes it, which is exactly the signal wanted.
 *
 * THE PAYLOAD `id` DOES NOT CHANGE. The spec calls it "unchanged from v2", and
 * that is load-bearing rather than cosmetic: `recipe_seed.rs`'s corpus-wide
 * coherence test asserts `source_use_case_id == prompt_template.id` and that
 * every `recipe_ref.id` equals `derive_recipe_id(template_id, payload_id)`.
 * Re-minting the payload id as the row uuid would break both.
 *
 * REFUSALS (loud, exit 1, nothing written): a bundle that is not version 2, a
 * payload that does not parse, a payload already v3-shaped (rerunning must
 * fail, not double-transform), a payload missing `id`/`title`, an overlay
 * entry with no id, an overlay id that no seed row carries, the same id in two
 * overlay files, or a reviewed overlay object that breaks the v3 vocabulary
 * rules (unknown connector category, `desktop`, activity count out of 3..8,
 * duplicate connector role, roles whose types disagree with `connectorTypes`).
 * The last one matters most: an overlay is the ONLY content nobody else
 * checks, and a gate that accepts anything is not a gate.
 *
 * DETERMINISM. Byte-for-byte identical on a re-run against the same inputs:
 * every object is built with a fixed key order, every derived list is deduped
 * in first-seen order, catalog files are read in sorted order, and no
 * timestamp, uuid or hash of the run enters the output. Prove it with
 * `--dry-run --print-digest` twice, or by transforming two copies and diffing.
 *
 * USAGE
 *   node scripts/templates/transform-recipes-v2-to-v3.mjs \
 *        [--seeds <path>] [--overlay <dir>] [--dry-run] [--print-digest]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// The shared normalization passes (`scripts/templates/_v3_normalize.mjs`,
// pure + separately unit-tested). Imported rather than reimplemented: every
// one of these encodes a judgment call about what a mechanical pass is
// ALLOWED to change, and a second copy of that judgment is a second place for
// it to drift. What they do, in the order applied below:
//   * reconcileConnectorRefKnobs — `connector_ref` / `source_definition` knobs
//     are a SECOND binding seam beside `connector_types`; they are folded into
//     it and dropped, so adoption has one seam and not two.
//   * demoteUncatalogedTypes — a v2 connector id with no catalog entry is a
//     TOOL, not a connector: `desktop_terminal` becomes a dependency. A type
//     the catalog merely does not know is KEPT and reported, never deleted.
//   * normalizeInputSchema — typography, inside `input_schema[].description`
//     ONLY. Never a name, an option value or a default: those are data.
//   * vendorEnumNotes / survivingBindingNotes — REPORT ONLY. A knob name is a
//     `{{param.<key>}}` substitution key, so renaming one breaks every persona
//     prompt already carrying it; a vendor name in an enum option may be the
//     actual choice being offered. Both are a human's call.
import {
  normalizeInputSchema,
  vendorEnumNotes,
  reconcileConnectorRefKnobs,
  demoteUncatalogedTypes,
  survivingBindingNotes,
  loadConnectorIndex,
  V2_CONNECTOR_TYPE_OVERRIDES,
  formatTypeNotes,
  formatConnectorRefNotes,
  formatSurvivingBindingNotes,
} from './_v3_normalize.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const CONNECTORS_DIR = path.join(ROOT, 'scripts', 'connectors', 'builtin');

// ---------------------------------------------------------------- args ----

function parseArgs(argv) {
  const out = { seeds: path.join(ROOT, 'scripts', 'templates', '_recipe_seeds.json'), overlay: null, dryRun: false, printDigest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seeds') out.seeds = path.resolve(argv[++i]);
    else if (a === '--overlay') out.overlay = path.resolve(argv[++i]);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--print-digest') out.printDigest = true;
    else {
      console.error(`REFUSED: unknown argument ${a}`);
      process.exit(1);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const failures = [];
const fail = (msg) => failures.push(msg);

/** Non-empty trimmed string, else undefined. */
const str = (v) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined);
/** Keep a value only when it is a non-empty array. */
const arr = (v) => (Array.isArray(v) && v.length > 0 ? v : undefined);
/** Keep a value only when it is a non-null object (arrays excluded). */
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : undefined);
/** First defined of several key spellings on an object. */
const pick = (o, ...keys) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};
/** Dedupe preserving first-seen order (determinism). */
const uniq = (list) => {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
};

// ------------------------------------------------------------- catalog ----

/** connector name -> its plural `categories`, and the closed category set. */
function readConnectorCatalog() {
  const byName = new Map();
  const categories = new Set();
  const files = fs.readdirSync(CONNECTORS_DIR).filter((f) => f.endsWith('.json')).sort();
  for (const file of files) {
    const c = JSON.parse(fs.readFileSync(path.join(CONNECTORS_DIR, file), 'utf8'));
    const cats = Array.isArray(c.categories) && c.categories.length > 0 ? c.categories : [c.category ?? 'general'];
    byName.set(c.name, cats);
    if (c.label) byName.set(String(c.label).toLowerCase(), cats);
    for (const cat of cats) categories.add(cat);
  }
  return { byName, categories };
}

const CATALOG = readConnectorCatalog();
/** alias -> connector id, for the report-only vendor/binding passes. */
const CONNECTOR_INDEX = loadConnectorIndex(CONNECTORS_DIR);
/** The shape the shared passes take: `(connector) => its categories`. */
const categoriesOf = (name) => CATALOG.byName.get(name) ?? CATALOG.byName.get(String(name).toLowerCase()) ?? [];

const ACTIVITY_KINDS = ['observe', 'decide', 'act', 'deliver'];
const STATUSES = ['seed', 'maturing', 'proven'];
const TRIGGER_KINDS = ['event', 'time', 'self_paced'];
const MIN_ACTIVITIES = 3;
const MAX_ACTIVITIES = 8;
/** Never a connector type: every agent has desktop access. */
const FORBIDDEN_TYPE = 'desktop';

// ----------------------------------------------------------- v3 shape ----

/**
 * Build the canonical v3 object with a FIXED key order. Every path into the
 * bundle goes through here, so mechanical and reviewed payloads serialize
 * identically-shaped and a re-run cannot reorder keys.
 */
function v3Object(fields) {
  const out = {
    id: fields.id,
    slug: fields.slug ?? '',
    title: fields.title ?? '',
    version: fields.version ?? '0.1.0',
    status: fields.status ?? 'seed',
    path: fields.path ?? '',
    domain: fields.domain ?? '',
    description: {
      need: fields.description?.need ?? '',
      input: fields.description?.input ?? '',
      coreAction: fields.description?.coreAction ?? '',
      output: fields.description?.output ?? '',
    },
    activities: (fields.activities ?? []).map((a) => ({
      id: a.id ?? '',
      label: a.label ?? '',
      kind: a.kind ?? '',
    })),
    outcomes: (fields.outcomes ?? []).map((o) => ({
      id: o.id ?? '',
      statement: o.statement ?? '',
      successCriteria: o.successCriteria ?? [],
    })),
    guidance: fields.guidance ?? '',
    connectorTypes: fields.connectorTypes ?? [],
    recommendedTrigger: {
      kind: fields.recommendedTrigger?.kind ?? 'self_paced',
      rationale: fields.recommendedTrigger?.rationale ?? '',
    },
    personalizationNeeds: fields.personalizationNeeds ?? [],
    dependencies: fields.dependencies ?? [],
    examples: (fields.examples ?? []).map((e) => ({
      title: e.title ?? '',
      connector: e.connector ?? '',
      connectorType: e.connectorType ?? '',
      notes: e.notes ?? '',
    })),
    lessons: fields.lessons ?? [],
    provenance: {
      fromRecipes: fields.provenance?.fromRecipes ?? [],
      fromTemplates: fields.provenance?.fromTemplates ?? [],
      ...(fields.provenance?.sourceTemplateId ? { sourceTemplateId: fields.provenance.sourceTemplateId } : {}),
    },
  };
  // Optional keys, appended in a fixed order so presence never reorders.
  if (fields.connectorRoles && fields.connectorRoles.length > 0) {
    out.connectorRoles = fields.connectorRoles.map((r) => ({
      role: r.role ?? '',
      type: r.type ?? '',
      note: r.note ?? '',
    }));
  }
  if (fields.inputSchema !== undefined && fields.inputSchema !== null) out.inputSchema = fields.inputSchema;
  if (fields.reviewNotes) out.reviewNotes = fields.reviewNotes;
  if (fields.transformNotes && fields.transformNotes.length > 0) out.transformNotes = fields.transformNotes;
  return out;
}

/** Formatted note lines from the shared passes, printed at the end of a run. */
const noteLines = [];
const noteCounts = { typography: 0, vendorEnum: 0, connectorRef: 0, typeDemoted: 0, typeUnknown: 0, survivingBinding: 0 };

/**
 * Run the shared normalization passes over a field bag and produce the final
 * canonical v3 object. BOTH content paths go through here — a reviewed recipe
 * and a mechanical one get identically normalized knobs, because the passes
 * fix seams that a reviewer had no reason to notice.
 */
function finalizeV3(fields) {
  const slug = fields.slug || fields.id;

  // Pass 3: fold the second binding seam into `connector_types` and drop it.
  const ref = reconcileConnectorRefKnobs(
    { input_schema: fields.inputSchema, connector_types: fields.connectorTypes ?? [] },
    { categoriesOf, knownCategories: CATALOG.categories },
  );
  // A dropped knob may name a concrete connector worth keeping as an example —
  // demoting an id to a type must not lose WHICH connector it was.
  const examples = [...(fields.examples ?? [])];
  for (const note of ref.notes) {
    if (!note.keepAsExample) continue;
    if (examples.some((e) => e.connector === note.keepAsExample)) continue;
    examples.push({ title: `${note.keepAsExample} as the bound connector`, connector: note.keepAsExample, connectorType: '', notes: '' });
  }

  // Pass 4: a v2 connector id with no catalog entry is a tool, not a type.
  const demoted = demoteUncatalogedTypes(
    { connector_types: ref.connectorTypes, dependencies: fields.dependencies ?? [] },
    { knownCategories: CATALOG.categories },
  );

  // Pass 1: typography, inside knob descriptions only.
  const beforeProse = JSON.stringify(ref.inputSchema ?? null);
  const inputSchema = normalizeInputSchema(ref.inputSchema);
  if (JSON.stringify(inputSchema ?? null) !== beforeProse) noteCounts.typography++;

  // Passes 2 and 5: report only.
  const vendor = vendorEnumNotes(inputSchema, CONNECTOR_INDEX);
  const surviving = survivingBindingNotes(inputSchema, CONNECTOR_INDEX);

  noteCounts.connectorRef += ref.notes.length;
  noteCounts.typeDemoted += demoted.notes.filter((n) => n.action === 'demoted').length;
  noteCounts.typeUnknown += demoted.notes.filter((n) => n.action === 'kept').length;
  noteCounts.vendorEnum += vendor.length;
  noteCounts.survivingBinding += surviving.length;
  noteLines.push(
    ...formatConnectorRefNotes(slug, ref.notes),
    ...formatTypeNotes(slug, demoted.notes),
    ...formatSurvivingBindingNotes(slug, surviving),
    ...vendor.map((n) => `  ${slug}: ${n.note}`),
  );

  return v3Object({
    ...fields,
    inputSchema,
    connectorTypes: demoted.connectorTypes,
    dependencies: demoted.dependencies,
    examples,
    transformNotes: [...ref.notes, ...demoted.notes, ...vendor, ...surviving].map((n) => n.note),
  });
}

/**
 * Read a reviewed overlay object written in EITHER casing (the spec document
 * writes snake_case, the wire is camelCase) and emit the canonical shape.
 * Tolerant on the way in, strict on the way out.
 */
function normalizeReviewed(raw) {
  const d = obj(pick(raw, 'description')) ?? {};
  const trig = obj(pick(raw, 'recommendedTrigger', 'recommended_trigger')) ?? {};
  const prov = obj(pick(raw, 'provenance')) ?? {};
  return finalizeV3({
    id: str(pick(raw, 'id')),
    slug: str(pick(raw, 'slug')),
    title: str(pick(raw, 'title')),
    version: str(pick(raw, 'version')),
    status: str(pick(raw, 'status')),
    path: str(pick(raw, 'path')),
    domain: str(pick(raw, 'domain')),
    description: {
      need: str(pick(d, 'need')) ?? '',
      input: str(pick(d, 'input')) ?? '',
      coreAction: str(pick(d, 'coreAction', 'core_action')) ?? '',
      output: str(pick(d, 'output')) ?? '',
    },
    activities: (arr(pick(raw, 'activities')) ?? []).map((a) => ({
      id: str(pick(a, 'id')) ?? '',
      label: str(pick(a, 'label')) ?? '',
      kind: str(pick(a, 'kind')) ?? '',
    })),
    outcomes: (arr(pick(raw, 'outcomes')) ?? []).map((o) => ({
      id: str(pick(o, 'id')) ?? '',
      statement: str(pick(o, 'statement')) ?? '',
      successCriteria: arr(pick(o, 'successCriteria', 'success_criteria')) ?? [],
    })),
    guidance: str(pick(raw, 'guidance')) ?? '',
    connectorTypes: uniq((arr(pick(raw, 'connectorTypes', 'connector_types')) ?? []).map((t) => String(t).trim()).filter(Boolean)),
    connectorRoles: (arr(pick(raw, 'connectorRoles', 'connector_roles')) ?? []).map((r) => ({
      role: str(pick(r, 'role')) ?? '',
      type: str(pick(r, 'type', 'connectorType', 'connector_type')) ?? '',
      note: str(pick(r, 'note')) ?? '',
    })),
    recommendedTrigger: {
      kind: str(pick(trig, 'kind')) ?? '',
      rationale: str(pick(trig, 'rationale')) ?? '',
    },
    personalizationNeeds: arr(pick(raw, 'personalizationNeeds', 'personalization_needs')) ?? [],
    dependencies: arr(pick(raw, 'dependencies')) ?? [],
    examples: (arr(pick(raw, 'examples')) ?? []).map((e) => ({
      title: str(pick(e, 'title')) ?? '',
      connector: str(pick(e, 'connector')) ?? '',
      connectorType: str(pick(e, 'connectorType', 'connector_type')) ?? '',
      notes: str(pick(e, 'notes')) ?? '',
    })),
    lessons: arr(pick(raw, 'lessons')) ?? [],
    inputSchema: pick(raw, 'inputSchema', 'input_schema'),
    provenance: {
      fromRecipes: arr(pick(prov, 'fromRecipes', 'from_recipes')) ?? [],
      fromTemplates: arr(pick(prov, 'fromTemplates', 'from_templates')) ?? [],
      sourceTemplateId: str(pick(prov, 'sourceTemplateId', 'source_template_id')),
    },
  });
}

/**
 * The same vocabulary rules `RecipeSpec::validation_errors` enforces in Rust.
 * Applied to REVIEWED objects only: a mechanical one is knowingly incomplete
 * and its gaps are the signal, not a failure.
 */
function reviewedViolations(v3) {
  const errors = [];
  if (!v3.title) errors.push('title is empty');
  if (!STATUSES.includes(v3.status)) errors.push(`status '${v3.status}' is not one of: ${STATUSES.join(', ')}`);
  if (v3.activities.length < MIN_ACTIVITIES || v3.activities.length > MAX_ACTIVITIES) {
    errors.push(`activities has ${v3.activities.length} entries; the contract is ${MIN_ACTIVITIES} to ${MAX_ACTIVITIES}`);
  }
  v3.activities.forEach((a, i) => {
    if (!a.id) errors.push(`activities[${i}] has no id`);
    if (!a.label) errors.push(`activities[${i}] has no label`);
    if (!ACTIVITY_KINDS.includes(a.kind)) errors.push(`activities[${i}] kind '${a.kind}' is not one of: ${ACTIVITY_KINDS.join(', ')}`);
  });
  if (!TRIGGER_KINDS.includes(v3.recommendedTrigger.kind)) {
    errors.push(`recommendedTrigger.kind '${v3.recommendedTrigger.kind}' is not one of: ${TRIGGER_KINDS.join(', ')}`);
  }
  v3.connectorTypes.forEach((t, i) => {
    if (t === FORBIDDEN_TYPE) errors.push("connectorTypes carries 'desktop', which is never a connector type");
    else if (!CATALOG.categories.has(t)) errors.push(`connectorTypes[${i}] '${t}' is not a connector catalog category`);
  });
  const roles = v3.connectorRoles ?? [];
  const seenRoles = new Set();
  roles.forEach((r, i) => {
    if (!r.role) errors.push(`connectorRoles[${i}] has no role name`);
    else if (seenRoles.has(r.role)) errors.push(`connectorRoles has a duplicate role '${r.role}'`);
    else seenRoles.add(r.role);
    if (!r.type) errors.push(`connectorRoles[${i}] has no type`);
    else if (r.type === FORBIDDEN_TYPE) errors.push(`connectorRoles[${i}] type is 'desktop', which is never a connector type`);
    else if (!CATALOG.categories.has(r.type)) errors.push(`connectorRoles[${i}] type '${r.type}' is not a connector catalog category`);
  });
  if (roles.length > 0) {
    const fromRoles = uniq(roles.map((r) => r.type).filter(Boolean)).sort();
    const declared = uniq(v3.connectorTypes).sort();
    if (JSON.stringify(fromRoles) !== JSON.stringify(declared)) {
      errors.push(`connectorTypes ${JSON.stringify(declared)} is not the distinct type set of connectorRoles ${JSON.stringify(fromRoles)}`);
    }
  }
  return errors;
}

// -------------------------------------------------- mechanical mapping ----

/** kebab-case slug from a title. Deterministic, ASCII-only. */
function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * v2 `procedure` -> (coreAction, guidance). The v1->v2 transform built
 * `procedure` as `capability_summary + "\n\n" + description`, so the first
 * paragraph IS the summary: it becomes the core action, and the rest becomes
 * the judgment prose. A single-paragraph procedure is all core action, and
 * `guidance` stays empty rather than being padded with a copy of it.
 */
function splitProcedure(procedure) {
  const paras = String(procedure ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length === 0) return { coreAction: '', guidance: '' };
  return { coreAction: paras[0], guidance: paras.slice(1).join('\n\n') };
}

/**
 * v2 connector IDS -> v3 connector TYPES, with each id kept as an example.
 * `desktop` is dropped outright. An id the catalog does not know contributes
 * no type (guessing a category from a name is fabrication) but is still kept
 * as an example so nothing the author wrote is lost.
 */
function demoteConnectors(connectors) {
  const types = [];
  const examples = [];
  for (const raw of connectors ?? []) {
    const id = String(raw ?? '').trim();
    if (!id) continue;
    // The shared override table first: a handful of v2 ids mean something
    // narrower than their catalog categories say (`codebase` is `development`,
    // not everything the codebase connector can reach) or nothing at all
    // (`desktop`, `desktop_terminal`). Taking the catalog at face value for
    // those widens the recipe past what it meant.
    const override = V2_CONNECTOR_TYPE_OVERRIDES.get(id);
    if (override) {
      for (const c of override.types) types.push(c);
      if (override.example) {
        examples.push({ title: `${id} as the bound connector`, connector: override.example, connectorType: override.types[0] ?? '', notes: '' });
      } else if (id !== FORBIDDEN_TYPE) {
        // `desktop_terminal` maps to no type; keep the id so pass 4 can move
        // it to `dependencies` where it belongs.
        types.push(id);
      }
      continue;
    }
    const cats = (CATALOG.byName.get(id) ?? CATALOG.byName.get(id.toLowerCase()) ?? []).filter((c) => c !== FORBIDDEN_TYPE);
    // If the v2 "connector" is ALREADY a category name (many are: `analytics`,
    // `email`), it is a type, not an instance, and gets no example.
    if (cats.length === 0) {
      // Unknown to the catalog and not a category either: keep the raw value
      // so `demoteUncatalogedTypes` decides (demote to a dependency, or keep
      // and report). Dropping it here would delete evidence silently.
      types.push(id);
      continue;
    }
    if (CATALOG.categories.has(id) && !CATALOG.byName.has(id)) {
      types.push(id);
      continue;
    }
    for (const c of cats) types.push(c);
    const primary = cats[0] ?? '';
    examples.push({
      title: `${id} as the ${primary || 'chosen'} connector`,
      connector: id,
      connectorType: primary,
      notes: '',
    });
  }
  return { types: uniq(types), examples };
}

/**
 * v2 `spec.suggestedTrigger` -> a v3 RECOMMENDATION.
 *
 * `schedule` does NOT become `time`. A v2 cron is evidence of one adopter's
 * DELIVERY PREFERENCE, not of work that is driven by a clock, and promoting it
 * to `time` would re-import the binding v3 exists to remove. It becomes
 * `self_paced` with that reasoning stated.
 *
 * Every OTHER declared kind becomes `event`: `manual`, `webhook`, `event`,
 * `polling`, `event_listener` and the long tail of one-off spellings the v2
 * corpus accumulated all describe work that starts when something arrives.
 * Only the ABSENCE of a trigger means self-paced.
 */
function recommendTrigger(suggestedTrigger) {
  const kind = str(pick(obj(suggestedTrigger) ?? {}, 'trigger_type', 'type'));
  if (!kind) {
    return { kind: 'self_paced', rationale: 'v2 carried no trigger; the work sets its own pace until an adopter says otherwise' };
  }
  if (kind === 'schedule') {
    return { kind: 'self_paced', rationale: 'v2 carried a schedule; treat as a delivery preference' };
  }
  return { kind: 'event', rationale: `v2 carried a ${kind} trigger; the work starts when something arrives` };
}

function mechanical(seed, v2) {
  const title = str(v2.title) ?? '';
  const domain = str(v2.domain) ?? 'general';
  const slug = slugify(title);
  const { coreAction, guidance } = splitProcedure(v2.procedure);
  const { types, examples } = demoteConnectors(v2.connectors);
  const spec = obj(v2.spec) ?? {};
  return finalizeV3({
    id: str(v2.id),
    slug,
    title,
    version: '0.1.0',
    status: 'seed',
    path: `${domain}/${slug}`,
    domain,
    description: { need: '', input: '', coreAction, output: '' },
    // Deliberately empty: a coarse activity sequence is authored judgment and
    // there is nothing in a v2 payload to derive one from. `useCaseFlow` is
    // NOT a source for it — that graph is the runbook v3 removed.
    activities: [],
    outcomes: (arr(v2.outcomes) ?? []).map((o) => ({
      id: str(pick(o, 'id')) ?? '',
      statement: str(pick(o, 'statement')) ?? '',
      successCriteria: arr(pick(o, 'successCriteria', 'success_criteria')) ?? [],
    })),
    guidance,
    connectorTypes: types,
    recommendedTrigger: recommendTrigger(pick(spec, 'suggestedTrigger', 'suggested_trigger')),
    personalizationNeeds: [],
    dependencies: [],
    examples,
    lessons: [],
    inputSchema: pick(spec, 'inputSchema', 'input_schema'),
    provenance: {
      fromRecipes: [],
      fromTemplates: seed.source_template_id ? [seed.source_template_id] : [],
      sourceTemplateId: str(seed.source_template_id),
    },
    reviewNotes: 'mechanical',
  });
}

// -------------------------------------------------------------- overlay ---

/** Read `v3_L*.json` overlay files into `id -> reviewed v3 object`. */
function readOverlay(dir) {
  const byId = new Map();
  if (!dir) return byId;
  if (!fs.existsSync(dir)) {
    console.error(`REFUSED: overlay directory ${dir} does not exist.`);
    process.exit(1);
  }
  const files = fs.readdirSync(dir).filter((f) => /^v3_L.*\.json$/.test(f)).sort();
  if (files.length === 0) {
    // A gate that looked at nothing is not the same as a gate that found
    // nothing: an overlay dir with no lane files is a mistake, not "no work".
    console.error(`REFUSED: overlay directory ${dir} contains no v3_L*.json files.`);
    process.exit(1);
  }
  for (const file of files) {
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (e) {
      fail(`overlay ${file}: not valid JSON: ${e.message}`);
      continue;
    }
    let entries;
    if (Array.isArray(doc)) entries = doc;
    else if (Array.isArray(doc.recipes)) entries = doc.recipes;
    else if (obj(doc)) entries = Object.values(doc).filter((v) => obj(v));
    else entries = [];
    if (entries.length === 0) fail(`overlay ${file}: no recipe objects found`);
    for (const raw of entries) {
      const id = str(pick(raw, 'id'));
      if (!id) {
        fail(`overlay ${file}: an entry has no id`);
        continue;
      }
      if (byId.has(id)) {
        fail(`overlay ${file}: id ${id} is also present in ${byId.get(id).file}`);
        continue;
      }
      byId.set(id, { file, raw });
    }
  }
  return byId;
}

// ------------------------------------------------------------------ run ---

const raw = fs.readFileSync(args.seeds, 'utf8');
const bundle = JSON.parse(raw);

if (bundle.version === 3) {
  console.error('REFUSED: bundle is already version 3. Running the transform twice would corrupt it.');
  process.exit(1);
}
if (bundle.version !== 2) {
  console.error(`REFUSED: bundle version is ${bundle.version}, expected 2.`);
  process.exit(1);
}
if (!Array.isArray(bundle.recipes) || bundle.recipes.length === 0) {
  console.error('REFUSED: bundle has no recipes[] array.');
  process.exit(1);
}

const overlay = readOverlay(args.overlay);
const seedIds = new Set();
const transformed = [];
let reviewedCount = 0;
let mechanicalCount = 0;

for (let index = 0; index < bundle.recipes.length; index++) {
  const seed = bundle.recipes[index];
  let v2;
  try {
    v2 = JSON.parse(seed.prompt_template);
  } catch (e) {
    fail(`recipes[${index}] (${seed.id}): prompt_template is not valid JSON: ${e.message}`);
    continue;
  }
  if (!obj(v2)) {
    fail(`recipes[${index}] (${seed.id}): prompt_template is not a JSON object`);
    continue;
  }
  if (Array.isArray(v2.activities) && obj(v2.description)) {
    fail(`recipes[${index}] (${seed.id}): payload is already v3 (activities + object description) — refusing to double-transform`);
    continue;
  }
  const id = str(v2.id);
  const title = str(v2.title);
  if (!id || !title) {
    fail(`recipes[${index}] (${seed.id}): payload is missing id/title`);
    continue;
  }
  // Two ids live on every seed: the ROW uuid (`seed.id`, what the lane files,
  // `_lanes_v3.json` and `provenance.from_recipes` all key on) and the payload
  // id (`v2.id`, the graph key the corpus canary derives recipe_ref ids from).
  // Reviewers key overlays on the row uuid; the payload id stays the graph key.
  seedIds.add(id);
  seedIds.add(seed.id);

  const reviewed = overlay.get(seed.id) ?? overlay.get(id);
  let v3;
  if (reviewed) {
    v3 = normalizeReviewed(reviewed.raw);
    // The payload id is the graph key; a reviewed object must not move it.
    v3.id = id;
    const violations = reviewedViolations(v3);
    for (const v of violations) fail(`overlay ${reviewed.file} (${id}): ${v}`);
    reviewedCount++;
  } else {
    v3 = mechanical(seed, v2);
    mechanicalCount++;
  }
  transformed.push({ seed, v3 });
}

// An overlay entry for a recipe that is not in the bundle is a proposal aimed
// at nothing: report it rather than dropping it silently.
for (const [id, entry] of overlay) {
  if (!seedIds.has(id)) fail(`overlay ${entry.file}: id ${id} matches no recipe in the bundle`);
}

if (failures.length > 0) {
  console.error(`REFUSED: ${failures.length} problem(s) — nothing was written.`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

// All-or-nothing write: only reached when every payload transformed.
for (const { seed, v3 } of transformed) {
  seed.prompt_template = JSON.stringify(v3);
}
bundle.version = 3;
const output = `${JSON.stringify(bundle, null, 2)}\n`;

if (args.printDigest) {
  console.log(`digest sha256:${crypto.createHash('sha256').update(output).digest('hex')}`);
}
if (args.dryRun) {
  console.log('--dry-run: nothing written.');
} else {
  fs.writeFileSync(args.seeds, output, 'utf8');
}

const withTypes = transformed.filter(({ v3 }) => v3.connectorTypes.length > 0).length;
const withExamples = transformed.filter(({ v3 }) => v3.examples.length > 0).length;
const withActivities = transformed.filter(({ v3 }) => v3.activities.length > 0).length;
const selfPaced = transformed.filter(({ v3 }) => v3.recommendedTrigger.kind === 'self_paced').length;
console.log(
  `Transformed ${transformed.length}/${bundle.recipes.length} recipe payloads to v3 (bundle version 2 -> 3).`,
);
console.log(
  `  reviewed from overlay: ${reviewedCount} · mechanical: ${mechanicalCount} · ` +
    `connectorTypes derived: ${withTypes} · examples kept: ${withExamples} · ` +
    `activities present: ${withActivities} · self_paced: ${selfPaced}`,
);
console.log(
  `  shared passes — typography: ${noteCounts.typography} · vendor-in-enum: ${noteCounts.vendorEnum} · ` +
    `connector_ref knobs folded: ${noteCounts.connectorRef} · types demoted to dependencies: ${noteCounts.typeDemoted} · ` +
    `unrecognized types kept: ${noteCounts.typeUnknown} · surviving-binding notes: ${noteCounts.survivingBinding}`,
);
for (const line of noteLines) console.log(line);
if (mechanicalCount > 0) {
  console.log(
    `  ${mechanicalCount} payload(s) carry reviewNotes:"mechanical" and NO activities — ` +
      'they will not pass RecipeSpec::validate until a review lane finishes them.',
  );
}
