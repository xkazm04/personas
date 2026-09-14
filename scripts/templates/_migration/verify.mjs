#!/usr/bin/env node
// Corpus-level review. The registry's own gate checks each recipe against the
// contract; this checks the CORPUS against itself, which no single lane can do
// because no lane can see the other nine.
//
//   node scripts/templates/_migration/verify.mjs
//
// Everything here is a REPORT, not a gate. Each finding is a question for a
// reviewer, and several of them are legitimately answered "yes, on purpose".
//
// Measured 2026-09-07 over the 105-recipe migration: the two heuristic checks
// (self_paced-and-threshold, binding-shaped knob NAMES) reported 7 findings and
// ALL SEVEN were false positives, which is the result the checks are for. The
// threshold matcher fires on recipes that discuss a threshold CRITICALLY - the
// significance watch's own trigger rationale names the peeking problem, which is
// the enrichment rather than the bug - and the knob matcher fires on the word
// "channel" where the knob names the subject of the work rather than a
// destination. Keep both broad: a false positive costs a reviewer one look, and
// the conditions they screen for are silent when they are real.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const LANE = path.join(
  process.env.AI_REGISTRY || path.resolve(ROOT, '..', 'ai-registry'),
  'recipes',
);

const recipes = [];
for (const d of fs.readdirSync(LANE, { withFileTypes: true }).filter((x) => x.isDirectory())) {
  for (const t of fs.readdirSync(path.join(LANE, d.name), { withFileTypes: true }).filter((x) => x.isDirectory())) {
    for (const s of fs.readdirSync(path.join(LANE, d.name, t.name), { withFileTypes: true }).filter((x) => x.isDirectory())) {
      const dir = path.join(LANE, d.name, t.name, s.name);
      const f = path.join(dir, 'recipe.json');
      if (!fs.existsSync(f)) continue;
      recipes.push({ dir, domain: d.name, topic: t.name, slug: s.name, o: JSON.parse(fs.readFileSync(f, 'utf8')) });
    }
  }
}
const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
const say = (title, rows) => {
  console.log(`\n## ${title}: ${rows.length}`);
  for (const r of rows.slice(0, 40)) console.log('  ' + r);
  if (rows.length > 40) console.log(`  ... and ${rows.length - 40} more`);
};

console.log(`corpus: ${recipes.length} recipes across ${new Set(recipes.map((r) => r.domain)).size} domains`);

// 1. Identity collisions. The gate checks duplicate SLUGS; nothing checks ids.
const byId = new Map();
for (const r of recipes) {
  if (!byId.has(r.o.id)) byId.set(r.o.id, []);
  byId.get(r.o.id).push(r.slug);
}
say('duplicate ids (identity collision, not gate-checked)',
  [...byId].filter(([, v]) => v.length > 1).map(([k, v]) => `${k} -> ${v.join(', ')}`));
say('ids that are not uuids',
  recipes.filter((r) => !/^[0-9a-f-]{36}$/i.test(String(r.o.id))).map((r) => `${r.slug}: ${r.o.id}`));

// 2. Lane-04's finding, applied corpus-wide: a recipe that judges against a
// threshold while pacing itself is peeking by construction. Worth a reviewer's
// eye everywhere, not only in the lane that found it.
const thresholdish = /\bthreshold|\bsignifican|p-value|confidence level|crosses?\b|exceeds?\b/i;
say('self_paced AND threshold-shaped (lane-04: peeking by construction)',
  recipes.filter((r) => r.o.recommended_trigger?.kind === 'self_paced'
    && (thresholdish.test(r.o.guidance ?? '') || (r.o.outcomes ?? []).some((o) => thresholdish.test(o.statement ?? ''))))
    .map((r) => `${r.domain}/${r.slug}`));

// 3. Bindings that survived into the craft layer.
const bindingish = /channel|webhook|recipient|slack|email_to|url$|_id$|credential|token|api_key/i;
say('input_schema knobs whose NAME still looks like a binding',
  recipes.flatMap((r) => (r.o.input_schema ?? []).map((k) => k?.name).filter((n) => n && bindingish.test(n))
    .map((n) => `${r.slug}: ${n}`)));
say('recipes still carrying a transformNotes array (an instruction to the migrator)',
  recipes.filter((r) => 'transformNotes' in r.o || 'transform_notes' in r.o).map((r) => r.slug));

// 4. Examples: the index and the files must agree, both directions.
const exampleProblems = [];
for (const r of recipes) {
  const dir = path.join(r.dir, 'examples');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
  const named = new Set((r.o.examples ?? []).map((e) => `${e.connector}.md`));
  for (const f of files) if (!named.has(f)) exampleProblems.push(`${r.slug}: examples/${f} on disk, no examples[] entry`);
  for (const n of named) if (!files.includes(n)) exampleProblems.push(`${r.slug}: examples[] names ${n}, no file`);
}
say('examples index and files disagree', exampleProblems);

// 5. Shape of the enrichment, so a thin lane is visible next to a thick one.
say('guidance outside 40-90 words', recipes.filter((r) => words(r.o.guidance) < 40 || words(r.o.guidance) > 90)
  .map((r) => `${r.slug}: ${words(r.o.guidance)}`));
say('use_cases under 12 words (an audience where a situation belongs)',
  recipes.flatMap((r) => (r.o.use_cases ?? []).filter((u) => words(u) < 12).map((u) => `${r.slug}: "${u}"`)));
say('recipes with no outcomes, or an outcome with no success criteria',
  recipes.filter((r) => !(r.o.outcomes ?? []).length || (r.o.outcomes ?? []).some((o) => !(o.success_criteria ?? []).length))
    .map((r) => r.slug));

// 6. Per-lane shape, so an outlier lane is visible at a glance.
console.log('\n## per-domain averages');
const byDomain = new Map();
for (const r of recipes) {
  if (!byDomain.has(r.domain)) byDomain.set(r.domain, []);
  byDomain.get(r.domain).push(r);
}
for (const [d, rs] of [...byDomain].sort()) {
  const avg = (f) => (rs.reduce((a, r) => a + f(r), 0) / rs.length).toFixed(1);
  console.log(`  ${d.padEnd(24)} n=${String(rs.length).padStart(2)}  use_cases ${avg((r) => (r.o.use_cases ?? []).length)}`
    + `  activities ${avg((r) => (r.o.activities ?? []).length)}`
    + `  guidance ${avg((r) => words(r.o.guidance))}w`
    + `  examples ${avg((r) => (r.o.examples ?? []).length)}`
    + `  triggers ${[...new Set(rs.map((r) => r.o.recommended_trigger?.kind))].join('/')}`);
}
