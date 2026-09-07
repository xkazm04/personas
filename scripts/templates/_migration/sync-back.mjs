#!/usr/bin/env node
// Fold the ENRICHED registry recipes back into the Personas bundle, so the dual
// copies hold the same craft instead of drifting from the day they were split.
//
//   node scripts/templates/_migration/sync-back.mjs --dry-run     # report, write nothing
//   node scripts/templates/_migration/sync-back.mjs               # content only
//   node scripts/templates/_migration/sync-back.mjs --promote     # content + status/version
//
// ! DO NOT RUN THIS WHILE A DEV APP IS RUNNING FROM THIS CHECKOUT.
//   `_recipe_seeds.json` is `include_str!`-ed into the Rust binary
//   (src-tauri/src/engine/recipe_seed.rs), so writing it triggers a cargo rebuild
//   and restarts the app, killing any fleet worker mid-run.
//
// WHAT --promote MEANS, AND WHY IT IS NOT THE DEFAULT
//
// The Personas corpus is a starting line: every recipe is `draft` with no version,
// and the contract says a recipe leaves draft when the OPERATOR promotes it, which
// is when it receives its first version. The registry copies are `seed` at 0.1.0
// because migration enriched them, which is the promotion criterion being met. But
// meeting the criterion and being promoted are two different acts, and the second
// one is the operator's. So by default this script copies the improved craft and
// leaves `status: draft` with no version; `--promote` lifts them too.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const BUNDLE = path.join(ROOT, 'scripts', 'templates', '_recipe_seeds.json');
const REGISTRY = process.env.AI_REGISTRY || path.resolve(ROOT, '..', 'ai-registry');
const LANE = path.join(REGISTRY, 'recipes');

const dryRun = process.argv.includes('--dry-run');
const promote = process.argv.includes('--promote');

const raw = fs.readFileSync(BUNDLE, 'utf8');
const bundle = JSON.parse(raw);
const serialize = (b) => JSON.stringify(b, null, 2) + '\n';
if (serialize(bundle) !== raw.replace(/\r\n/g, '\n')) {
  console.error('refusing: my serialization does not round-trip the bundle; the format drifted');
  process.exit(1);
}

const lanes = JSON.parse(fs.readFileSync(path.join(HERE, 'LANES.json'), 'utf8'));
const wanted = new Map();
for (const lane of lanes.lanes) for (const r of lane.recipes) wanted.set(r.slug, r.path);

// snake_case (registry) -> camelCase (bundle). The mirror of rx.mjs `toRegistry`,
// and the only other place a rename may live.
function toBundle(o, prev) {
  const d = o.description || {};
  const out = {
    id: o.id,
    slug: o.slug,
    title: o.title,
    status: promote ? o.status : 'draft',
    path: o.path,
    domain: o.domain,
    description: { need: d.need, input: d.input, coreAction: d.core_action, output: d.output },
    activities: (o.activities || []).map((a) => ({ id: a.id, label: a.label, kind: a.kind })),
    outcomes: (o.outcomes || []).map((x) => ({ id: x.id, statement: x.statement, successCriteria: x.success_criteria || [] })),
    guidance: o.guidance,
    useCases: o.use_cases || [],
    connectorTypes: o.connector_types || [],
    recommendedTrigger: o.recommended_trigger,
    personalizationNeeds: o.personalization_needs || [],
    dependencies: o.dependencies || [],
    examples: (o.examples || []).map((e) => ({ title: e.title, connector: e.connector, connectorType: e.connector_type, notes: e.notes })),
    lessons: o.lessons || [],
    provenance: {
      fromRecipes: o.provenance?.from_recipes || [],
      fromTemplates: o.provenance?.from_templates || [],
      sourceTemplateId: o.provenance?.source_template_id || '',
    },
    inputSchema: o.input_schema || [],
  };
  if (promote && o.version) out.version = o.version;
  // Key order follows the bundle's own payloads so a diff reads as content.
  const order = ['id', 'slug', 'title', 'version', 'status', 'path', 'domain', 'description', 'activities',
    'outcomes', 'guidance', 'useCases', 'connectorTypes', 'recommendedTrigger', 'personalizationNeeds',
    'dependencies', 'examples', 'lessons', 'provenance', 'inputSchema'];
  const ordered = {};
  for (const k of order) if (k in out) ordered[k] = out[k];
  for (const k of Object.keys(prev || {})) if (!(k in ordered) && k !== 'version') ordered[k] = prev[k];
  return ordered;
}

let updated = 0;
let skipped = 0;
const notes = [];
for (const row of bundle.recipes) {
  const prev = JSON.parse(row.prompt_template);
  const topicPath = wanted.get(prev.slug);
  if (!topicPath) { skipped += 1; continue; }  // descoped (App Master) or not in a lane
  const file = path.join(LANE, topicPath, prev.slug, 'recipe.json');
  if (!fs.existsSync(file)) { notes.push(`${prev.slug}: not migrated yet`); continue; }
  const o = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(o.use_cases) || o.use_cases.length === 0) { notes.push(`${prev.slug}: registry copy has no use_cases, not folding a half-done recipe back`); continue; }
  const next = toBundle(o, prev);
  const nextStr = JSON.stringify(next);
  if (nextStr === row.prompt_template) continue;
  row.prompt_template = nextStr;
  row.name = next.title;
  row.description = [next.description.need, next.description.coreAction].filter(Boolean).join(' ');
  updated += 1;
}

console.log(`${updated} payload(s) would change, ${skipped} out of scope (App Master descope), ${notes.length} note(s)`);
for (const n of notes) console.log(`  - ${n}`);
if (dryRun) { console.log('\n--dry-run: nothing written'); process.exit(0); }
if (!updated) { console.log('nothing to write'); process.exit(0); }
fs.writeFileSync(BUNDLE, serialize(bundle), 'utf8');
console.log(`\nwrote ${path.relative(ROOT, BUNDLE)}`);
console.log('now run: node scripts/templates/generate-recipe-index.mjs');
console.log(promote ? 'status/version PROMOTED to the registry values' : 'status stayed `draft` (pass --promote to lift it)');
