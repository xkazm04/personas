/**
 * Tests for _v3_normalize.mjs. Run: `node --test scripts/templates/_v3_normalize.test.mjs`
 *
 * Vitest does not see this file - `vitest.config.ts` includes only `src/**` - so
 * the runtime's own runner is what pins these. No install, no dependencies.
 *
 * The load-bearing assertions are the NEGATIVE ones: that names, types, defaults,
 * options, min and max come out byte-identical. A typography pass that quietly
 * rewrote a character inside an enum option would change which branch a recipe
 * takes, and nothing downstream would notice.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProse,
  normalizeInputSchema,
  countProseRewrites,
  connectorAliases,
  vendorEnumNotes,
  formatVendorEnumNotes,
  CONNECTOR_REF_TYPES,
  reconcileConnectorRefKnobs,
  formatConnectorRefNotes,
  UNCATALOGED_V2_CONNECTOR_IDS,
  demoteUncatalogedTypes,
  formatTypeNotes,
  V2_CONNECTOR_TYPE_OVERRIDES,
  survivingBindingNotes,
  formatSurvivingBindingNotes,
} from './_v3_normalize.mjs';

// ------------------------------------------------------------------ typography

test('normalizeProse rewrites em and en dashes to a spaced hyphen', () => {
  assert.equal(normalizeProse('a — b'), 'a - b');
  assert.equal(normalizeProse('a—b'), 'a - b');
  assert.equal(normalizeProse('a – b'), 'a - b');
  assert.equal(normalizeProse('a–b'), 'a - b');
});

test('normalizeProse rewrites arrows and the ellipsis', () => {
  assert.equal(normalizeProse('draft → review'), 'draft -> review');
  assert.equal(normalizeProse('draft→review'), 'draft -> review');
  assert.equal(normalizeProse('a ← b'), 'a <- b');
  assert.equal(normalizeProse('a ↔ b'), 'a <-> b');
  assert.equal(normalizeProse('a ⇒ b'), 'a => b');
  assert.equal(normalizeProse('wait…'), 'wait...');
});

test('normalizeProse leaves ASCII prose byte-identical', () => {
  const s = 'Pick the window - the slower metric decides it. See docs/x.md for the 3 -> 8 rule.';
  assert.equal(normalizeProse(s), s);
});

test('normalizeProse is idempotent', () => {
  const once = normalizeProse('a — b → c…');
  assert.equal(normalizeProse(once), once);
});

test('normalizeProse leaves content characters alone', () => {
  // Accents, non-Latin script and currency are content, not punctuation.
  const s = 'Prühodnost, 使用量, €12 per seat';
  assert.equal(normalizeProse(s), s);
});

test('normalizeProse does not trim whitespace the author wrote', () => {
  assert.equal(normalizeProse('  padded  '), '  padded  ');
  assert.equal(normalizeProse('a\nb'), 'a\nb');
});

test('normalizeProse passes non-strings through untouched', () => {
  assert.equal(normalizeProse(null), null);
  assert.equal(normalizeProse(7), 7);
  assert.equal(normalizeProse(undefined), undefined);
});

test('normalizeInputSchema rewrites description AND NOTHING ELSE', () => {
  const before = [
    {
      name: 'report_delivery—mode',
      type: 'select',
      description: 'Where the digest lands — pick one…',
      default: 'slack—dm',
      options: ['slack—dm', 'notion'],
      min: 1,
      max: 8,
    },
  ];
  const frozen = JSON.parse(JSON.stringify(before));
  const after = normalizeInputSchema(before);

  assert.equal(after[0].description, 'Where the digest lands - pick one...');
  // Every other key survives byte-identical, dashes included.
  assert.equal(after[0].name, frozen[0].name);
  assert.equal(after[0].type, frozen[0].type);
  assert.equal(after[0].default, frozen[0].default);
  assert.deepEqual(after[0].options, frozen[0].options);
  assert.equal(after[0].min, frozen[0].min);
  assert.equal(after[0].max, frozen[0].max);
  // And the input is not mutated.
  assert.deepEqual(before, frozen);
});

test('normalizeInputSchema returns the same object identity when nothing changed', () => {
  const field = { name: 'n', description: 'plain ascii' };
  const after = normalizeInputSchema([field]);
  assert.equal(after[0], field, 'an untouched field is passed through by reference');
});

test('normalizeInputSchema tolerates a missing or malformed schema', () => {
  assert.equal(normalizeInputSchema(undefined), undefined);
  assert.equal(normalizeInputSchema(null), null);
  assert.deepEqual(normalizeInputSchema([null, 'x', { name: 'n' }]), [null, 'x', { name: 'n' }]);
});

test('countProseRewrites counts only the fields that would change', () => {
  const schema = [
    { name: 'a', description: 'clean' },
    { name: 'b', description: 'dirty — here' },
    { name: 'c' },
    { name: 'd', description: 'also … dirty' },
  ];
  assert.equal(countProseRewrites(schema), 2);
  assert.equal(countProseRewrites(undefined), 0);
});

// ------------------------------------------------------------- vendor in enums

test('connectorAliases covers the id, the bare id and the name', () => {
  assert.deepEqual(
    connectorAliases({ id: 'builtin-notion', name: 'notion' }).sort(),
    ['builtin-notion', 'notion'],
  );
  assert.deepEqual(connectorAliases({ id: 'builtin-x-twitter', name: 'x-twitter' }).sort(),
    ['builtin-x-twitter', 'x-twitter']);
  assert.deepEqual(connectorAliases({}), []);
});

const INDEX = new Map([
  ['notion', 'builtin-notion'],
  ['builtin-notion', 'builtin-notion'],
  ['slack', 'builtin-slack'],
  ['email', 'builtin-sendgrid'],
]);

test('vendorEnumNotes reports each matching enum option and changes nothing', () => {
  const schema = [{
    name: 'report_delivery',
    type: 'select',
    options: ['notion', 'email', 'slack', 'nowhere'],
  }];
  const frozen = JSON.parse(JSON.stringify(schema));
  const notes = vendorEnumNotes(schema, INDEX);

  assert.equal(notes.length, 3);
  assert.deepEqual(notes.map((n) => n.option), ['notion', 'email', 'slack']);
  assert.deepEqual(notes.map((n) => n.connector), ['builtin-notion', 'builtin-sendgrid', 'builtin-slack']);
  assert.equal(notes[0].field, 'report_delivery');
  assert.equal(notes[0].kind, 'vendor-in-enum');
  assert.deepEqual(schema, frozen, 'reporting never rewrites');
});

test('vendorEnumNotes matches on a whole option value, never a substring', () => {
  // "email digest" contains "email" and is NOT a vendor binding. A substring
  // matcher fires on it and produces a list nobody reads.
  const notes = vendorEnumNotes([{ name: 'f', options: ['email digest', 'notionally'] }], INDEX);
  assert.deepEqual(notes, []);
});

test('vendorEnumNotes reads object-shaped options and is case and space tolerant', () => {
  const notes = vendorEnumNotes(
    [{ name: 'f', options: [{ value: ' Notion ', label: 'Notion' }, { label: 'no value' }] }],
    INDEX,
  );
  assert.equal(notes.length, 1);
  assert.equal(notes[0].connector, 'builtin-notion');
});

test('vendorEnumNotes returns [] for anything without enum options', () => {
  assert.deepEqual(vendorEnumNotes(undefined, INDEX), []);
  assert.deepEqual(vendorEnumNotes([{ name: 'f', type: 'text' }], INDEX), []);
  assert.deepEqual(vendorEnumNotes([null, 'x'], INDEX), []);
});

test('formatVendorEnumNotes renders one line per note', () => {
  const notes = vendorEnumNotes([{ name: 'f', options: ['slack'] }], INDEX);
  assert.deepEqual(formatVendorEnumNotes('my-recipe', notes), [
    '  my-recipe: input_schema.f option "slack" -> connector builtin-slack',
  ]);
});

// -------------------------------------------------------- connector_ref knobs

const KNOWN = new Set(['source_control', 'analytics', 'social', 'database', 'desktop']);
const CATS = (name) => ({
  // A neutral id with no entry in V2_CONNECTOR_TYPE_OVERRIDES, so these cases
  // pin the GENERIC derivation path. The overridden ids get their own block below.
  'acme-scm': ['source_control', 'desktop'],
  posthog: ['analytics'],
}[name] ?? []);
const RECONCILE_ARGS = { categoriesOf: CATS, knownCategories: KNOWN };

test('CONNECTOR_REF_TYPES covers both shapes the corpus uses', () => {
  assert.ok(CONNECTOR_REF_TYPES.has('connector_ref'));
  assert.ok(CONNECTOR_REF_TYPES.has('source_definition'));
  assert.equal(CONNECTOR_REF_TYPES.has('enum'), false);
});

test('a connector_ref knob is dropped as a duplicate when types are already declared', () => {
  const recipe = {
    connector_types: ['source_control'],
    input_schema: [
      { name: 'target_scm', type: 'connector_ref', connector: 'acme-scm' },
      { name: 'window_days', type: 'number', default: 7 },
    ],
  };
  const frozen = JSON.parse(JSON.stringify(recipe));
  const out = reconcileConnectorRefKnobs(recipe, RECONCILE_ARGS);

  assert.deepEqual(out.inputSchema.map((f) => f.name), ['window_days']);
  assert.deepEqual(out.connectorTypes, ['source_control'], 'declared types win; nothing is added');
  assert.equal(out.notes.length, 1);
  assert.equal(out.notes[0].action, 'dropped-duplicate');
  assert.deepEqual(recipe, frozen, 'the input is never mutated');
});

test('a type is DERIVED from the knob only when the recipe declares none', () => {
  const out = reconcileConnectorRefKnobs({
    input_schema: [{ name: 'target_scm', type: 'connector_ref', connector: 'acme-scm' }],
  }, RECONCILE_ARGS);
  assert.deepEqual(out.connectorTypes, ['source_control'], 'desktop is never derived');
  assert.equal(out.notes[0].action, 'dropped-and-derived');
  assert.deepEqual(out.notes[0].derivedTypes, ['source_control']);
});

test('an explicit connector_type on the field is honoured', () => {
  const out = reconcileConnectorRefKnobs({
    input_schema: [{ name: 'src', type: 'source_definition', connector_type: 'analytics' }],
  }, RECONCILE_ARGS);
  assert.deepEqual(out.connectorTypes, ['analytics']);
});

test('nothing is invented: an underivable knob is reported UNRESOLVED', () => {
  const out = reconcileConnectorRefKnobs({
    input_schema: [{ name: 'mystery', type: 'connector_ref', connector: 'not-in-catalog' }],
  }, RECONCILE_ARGS);
  assert.deepEqual(out.inputSchema, [], 'the second seam still goes');
  assert.deepEqual(out.connectorTypes, [], 'and no type is guessed in its place');
  assert.equal(out.notes[0].action, 'dropped-unresolved');
  assert.match(out.notes[0].note, /a human must supply one/);
});

test('a value outside the known category set is not treated as a type', () => {
  const out = reconcileConnectorRefKnobs({
    input_schema: [{ name: 'src', type: 'connector_ref', connector_type: 'not_a_category' }],
  }, RECONCILE_ARGS);
  assert.deepEqual(out.connectorTypes, []);
  assert.equal(out.notes[0].action, 'dropped-unresolved');
});

test('a recipe with no connector_ref knobs is passed through unchanged', () => {
  const recipe = { connector_types: ['analytics'], input_schema: [{ name: 'n', type: 'number' }] };
  const out = reconcileConnectorRefKnobs(recipe, RECONCILE_ARGS);
  assert.deepEqual(out.inputSchema, recipe.input_schema);
  assert.deepEqual(out.connectorTypes, ['analytics']);
  assert.deepEqual(out.notes, []);
});

test('a missing input_schema is tolerated', () => {
  const out = reconcileConnectorRefKnobs({ connector_types: ['social'] }, RECONCILE_ARGS);
  assert.equal(out.inputSchema, undefined);
  assert.deepEqual(out.connectorTypes, ['social']);
  assert.deepEqual(out.notes, []);
});

test('formatConnectorRefNotes distinguishes the three outcomes', () => {
  const derived = reconcileConnectorRefKnobs(
    { input_schema: [{ name: 'a', type: 'connector_ref', connector: 'acme-scm' }] }, RECONCILE_ARGS,
  ).notes;
  const dup = reconcileConnectorRefKnobs(
    { connector_types: ['analytics'], input_schema: [{ name: 'b', type: 'connector_ref' }] }, RECONCILE_ARGS,
  ).notes;
  const unresolved = reconcileConnectorRefKnobs(
    { input_schema: [{ name: 'c', type: 'connector_ref' }] }, RECONCILE_ARGS,
  ).notes;

  assert.deepEqual(formatConnectorRefNotes('r', derived), ['  r: dropped input_schema.a (connector_ref) -> connector_types [source_control]']);
  assert.deepEqual(formatConnectorRefNotes('r', dup), ['  r: dropped input_schema.b (connector_ref) -> already declared']);
  assert.deepEqual(formatConnectorRefNotes('r', unresolved), ['  r: dropped input_schema.c (connector_ref) -> UNRESOLVED, needs a human']);
});

// ------------------------------------------- types that are not catalog categories

const CATS_KNOWN = new Set(['source_control', 'analytics', 'social']);

test('a catalog category passes through untouched', () => {
  const out = demoteUncatalogedTypes(
    { connector_types: ['analytics', 'social'], dependencies: ['ffmpeg'] },
    { knownCategories: CATS_KNOWN },
  );
  assert.deepEqual(out.connectorTypes, ['analytics', 'social']);
  assert.deepEqual(out.dependencies, ['ffmpeg']);
  assert.deepEqual(out.notes, []);
});

test('desktop_terminal is demoted from a type to a dependency', () => {
  assert.ok(UNCATALOGED_V2_CONNECTOR_IDS.has('desktop_terminal'));
  const out = demoteUncatalogedTypes(
    { connector_types: ['source_control', 'desktop_terminal'] },
    { knownCategories: CATS_KNOWN },
  );
  assert.deepEqual(out.connectorTypes, ['source_control']);
  assert.deepEqual(out.dependencies, ['desktop_terminal']);
  assert.equal(out.notes.length, 1);
  assert.equal(out.notes[0].action, 'demoted');
});

test('demotion is idempotent and never duplicates an existing dependency', () => {
  const once = demoteUncatalogedTypes(
    { connector_types: ['desktop_terminal'], dependencies: ['desktop_terminal'] },
    { knownCategories: CATS_KNOWN },
  );
  assert.deepEqual(once.dependencies, ['desktop_terminal']);
});

test('an UNRECOGNIZED type is KEPT, never dropped - the list may legitimately grow', () => {
  // A reviewer can add a type on a superseding responsibility's authority. A
  // mechanical pass that assumed types only shrink would delete that decision.
  const out = demoteUncatalogedTypes(
    { connector_types: ['legal', 'analytics'] },
    { knownCategories: CATS_KNOWN },
  );
  assert.deepEqual(out.connectorTypes, ['legal', 'analytics']);
  assert.deepEqual(out.dependencies, []);
  assert.equal(out.notes.length, 1);
  assert.equal(out.notes[0].action, 'kept');
  assert.match(out.notes[0].note, /KEPT, not dropped/);
});

test('the demote list is overridable', () => {
  const out = demoteUncatalogedTypes(
    { connector_types: ['some_old_id'] },
    { knownCategories: CATS_KNOWN, demoteIds: new Set(['some_old_id']) },
  );
  assert.deepEqual(out.connectorTypes, []);
  assert.deepEqual(out.dependencies, ['some_old_id']);
});

test('demoteUncatalogedTypes tolerates a recipe with neither field', () => {
  const out = demoteUncatalogedTypes({}, { knownCategories: CATS_KNOWN });
  assert.deepEqual(out, { connectorTypes: [], dependencies: [], notes: [] });
});

test('formatTypeNotes renders both outcomes', () => {
  const notes = demoteUncatalogedTypes(
    { connector_types: ['desktop_terminal', 'legal'] },
    { knownCategories: CATS_KNOWN },
  ).notes;
  assert.deepEqual(formatTypeNotes('r', notes), [
    '  r: connector_types "desktop_terminal" -> dependencies',
    '  r: connector_types "legal" -> KEPT, unrecognized, confirm',
  ]);
});


// ------------------------------------------- v2 connector id overrides

const WIDE = new Set(['development', 'source_control', 'desktop', 'browser_automation']);
// The catalog's real answer for these ids, measured 2026-09-06.
const WIDE_CATS = (n) => ({
  codebase: ['development', 'source_control', 'desktop'],
  desktop_browser: ['browser_automation', 'desktop'],
  desktop_terminal: [],
}[n] ?? []);
const WIDE_ARGS = { categoriesOf: WIDE_CATS, knownCategories: WIDE };

test('codebase derives development ONLY - source_control would widen it to GitHub', () => {
  const out = reconcileConnectorRefKnobs(
    { input_schema: [{ name: 'target_codebase', type: 'connector_ref', connector: 'codebase' }] },
    WIDE_ARGS,
  );
  assert.deepEqual(out.connectorTypes, ['development']);
  assert.equal(out.notes[0].keepAsExample, 'codebase', 'the concrete id survives as an example');
});

test('desktop_browser derives browser_automation, never desktop', () => {
  const out = reconcileConnectorRefKnobs(
    { input_schema: [{ name: 'browser', type: 'connector_ref', connector: 'desktop_browser' }] },
    WIDE_ARGS,
  );
  assert.deepEqual(out.connectorTypes, ['browser_automation']);
  assert.equal(out.notes[0].keepAsExample, 'desktop_browser');
});

test('a desktop-only v2 id derives no type at all', () => {
  assert.deepEqual(V2_CONNECTOR_TYPE_OVERRIDES.get('desktop').types, []);
  const out = reconcileConnectorRefKnobs(
    { input_schema: [{ name: 'd', type: 'connector_ref', connector: 'desktop' }] },
    WIDE_ARGS,
  );
  assert.deepEqual(out.connectorTypes, []);
  assert.equal(out.notes[0].action, 'dropped-unresolved');
});

test('desktop is filtered out of any catalog-derived set', () => {
  const out = reconcileConnectorRefKnobs(
    { input_schema: [{ name: 'x', type: 'connector_ref', connector: 'obsidian' }] },
    { categoriesOf: () => ['knowledge_base', 'desktop'], knownCategories: new Set(['knowledge_base', 'desktop']) },
  );
  assert.deepEqual(out.connectorTypes, ['knowledge_base']);
});

// ------------------------------------------- knob names that still carry bindings

test('a connector id inside a knob NAME is reported, never renamed', () => {
  const schema = [{ name: 'buffer_queue', type: 'text' }];
  const frozen = JSON.parse(JSON.stringify(schema));
  const notes = survivingBindingNotes(schema, new Map([['buffer', 'builtin-buffer']]));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, 'connector-in-knob-name');
  assert.equal(notes[0].match, 'buffer');
  assert.match(notes[0].note, /^knob:buffer_queue: /);
  assert.match(notes[0].note, /breaks every persona prompt/);
  assert.deepEqual(schema, frozen, 'reporting never rewrites');
});

test('a knob name is matched word by word, not as a substring haystack', () => {
  // "slack_channel" -> slack. "notionally_related" -> no word "notion".
  const idx = new Map([['slack', 'builtin-slack'], ['notion', 'builtin-notion']]);
  assert.equal(survivingBindingNotes([{ name: 'slack_channel' }], idx).length, 1);
  assert.equal(survivingBindingNotes([{ name: 'notionally_related' }], idx).length, 0);
});

test('a connector named in a knob DESCRIPTION is reported once', () => {
  const notes = survivingBindingNotes(
    [{ name: 'subreddits', description: 'Which Reddit communities to watch.' }],
    new Map([['reddit', 'builtin-reddit']]),
  );
  assert.equal(notes.filter((n) => n.kind === 'connector-in-knob-description').length, 1);
});

test('cadence words are reported from the name, default or description', () => {
  const idx = new Map();
  const byName = survivingBindingNotes([{ name: 'weekly_digest' }], idx);
  assert.equal(byName[0].kind, 'cadence-in-knob');
  assert.equal(byName[0].where, 'name');
  const byDefault = survivingBindingNotes([{ name: 'frequency', default: 'per week' }], idx);
  assert.equal(byDefault[0].where, 'default');
  assert.equal(byDefault[0].match, 'per week');
  const byDesc = survivingBindingNotes([{ name: 'f', description: 'Runs every 3 days.' }], idx);
  assert.equal(byDesc[0].where, 'description');
});

test('a clean knob produces no notes', () => {
  assert.deepEqual(survivingBindingNotes([{ name: 'window_size', description: 'How far back to look.' }], new Map()), []);
  assert.deepEqual(survivingBindingNotes(undefined, new Map()), []);
});

test('formatSurvivingBindingNotes renders both shapes', () => {
  const idx = new Map([['slack', 'builtin-slack']]);
  const notes = survivingBindingNotes([{ name: 'slack_channel' }, { name: 'weekly_run' }], idx);
  assert.deepEqual(formatSurvivingBindingNotes('r', notes), [
    '  r: knob:slack_channel name carries "slack" -> builtin-slack',
    '  r: knob:weekly_run name carries "weekly" (cadence)',
  ]);
});
