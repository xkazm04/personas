#!/usr/bin/env node
// rx - recipe exchange. The shared tool for the Personas -> ai-registry migration.
//
//   node scripts/templates/_migration/rx.mjs show <slug>       # the current v3 payload, pretty
//   node scripts/templates/_migration/rx.mjs scaffold <slug>   # create the registry directory + files
//   node scripts/templates/_migration/rx.mjs render <slug>     # re-render RECIPE.md from recipe.json
//   node scripts/templates/_migration/rx.mjs status [lane-03]  # what is migrated, what is not
//
// TWO RULES THIS TOOL EXISTS TO ENFORCE
//
// 1. `recipe.json` is AUTHORED; `RECIPE.md` is GENERATED. The lane's gate compares five
//    frontmatter keys against the JSON and fails on drift, so hand-editing the rendered
//    view is a way to fail the gate later for a reason nobody remembers. Edit the JSON,
//    then `render`.
// 2. The scaffold writes `use_cases: []`, which FAILS the gate on purpose. The mechanical
//    part of this migration is worth automating; the part that makes a recipe worth
//    finding is not, and a red gate is the only reliable reminder.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PERSONAS = path.resolve(HERE, '..', '..', '..');
const BUNDLE = path.join(PERSONAS, 'scripts', 'templates', '_recipe_seeds.json');
const REGISTRY = process.env.AI_REGISTRY || 'C:/Users/kazda/kiro/ai-registry';
const LANE = path.join(REGISTRY, 'recipes');

const bundle = JSON.parse(fs.readFileSync(BUNDLE, 'utf8'));
if (bundle.version !== 3) { console.error(`bundle version ${bundle.version}, expected 3`); process.exit(1); }
const payloads = new Map();
for (const row of bundle.recipes) {
  const p = JSON.parse(row.prompt_template);
  // EVERY seed row has TWO ids and only one of them belongs in the registry.
  // `row.id` is the stable uuid the v2 corpus was keyed on and is unique per
  // recipe; `p.id` is the payload's internal graph key (`uc_triage` and friends),
  // which the consuming app derives `recipe_ref` from and which REPEATS across
  // recipes - three of them share `uc_triage`. The registry lane's `id` is the
  // "stable uuid, unchanged from v2", so it is the row's.
  if (p.slug) payloads.set(p.slug, { ...p, id: row.id, __payload_id: p.id });
}
const lanes = JSON.parse(fs.readFileSync(path.join(HERE, 'LANES.json'), 'utf8'));

const die = (m) => { console.error(m); process.exit(1); };
const get = (slug) => payloads.get(slug) || die(`no recipe with slug "${slug}" in the bundle`);

// ------------------------------------------------------------------ convert
// The bundle is camelCase; the registry lane is snake_case. Every rename lives
// here and nowhere else, so a missed one is a single bug rather than a hundred.
function toRegistry(p) {
  const d = p.description || {};
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    version: '0.1.0',
    status: 'seed',
    path: p.path,
    domain: p.domain,
    description: {
      need: d.need ?? '',
      input: d.input ?? '',
      core_action: d.coreAction ?? d.core_action ?? '',
      output: d.output ?? '',
    },
    activities: (p.activities || []).map((a) => ({ id: a.id, label: a.label, kind: a.kind })),
    outcomes: (p.outcomes || []).map((o) => ({
      id: o.id,
      statement: o.statement,
      success_criteria: o.successCriteria ?? o.success_criteria ?? [],
    })),
    guidance: p.guidance ?? '',
    use_cases: [],
    connector_types: p.connectorTypes ?? p.connector_types ?? [],
    recommended_trigger: p.recommendedTrigger ?? p.recommended_trigger ?? { kind: 'self_paced', rationale: '' },
    personalization_needs: p.personalizationNeeds ?? p.personalization_needs ?? [],
    dependencies: p.dependencies ?? [],
    input_schema: p.inputSchema ?? p.input_schema ?? [],
    examples: (p.examples || []).map((e) => ({
      title: e.title,
      connector: e.connector,
      connector_type: e.connectorType ?? e.connector_type,
      notes: e.notes,
    })),
    lessons: [],
    provenance: {
      from_recipes: p.provenance?.fromRecipes ?? p.provenance?.from_recipes ?? [],
      from_templates: p.provenance?.fromTemplates ?? p.provenance?.from_templates ?? [],
      source_template_id: p.provenance?.sourceTemplateId ?? p.provenance?.source_template_id ?? '',
    },
  };
}

// ------------------------------------------------------------------- render
const wrap = (s, w = 88, indent = '') => {
  const out = [];
  let line = indent;
  for (const word of String(s).trim().split(/\s+/)) {
    if (line.trim() && (line + ' ' + word).length > w) { out.push(line); line = indent + word; }
    else line = line.trim() ? line + ' ' + word : indent + word;
  }
  if (line.trim()) out.push(line);
  return out.join('\n');
};

const bullets = (arr, w = 88) => (arr || []).map((s) => {
  const t = wrap(s, w - 2, '').split('\n');
  const rest = t.length > 1 ? '\n' + t.slice(1).map((x) => '  ' + x).join('\n') : '';
  return `- ${t[0]}${rest}`;
}).join('\n');

const NO_CONNECTOR = 'None. This work needs no external connector: the tools the agent already has are enough.';

function renderMd(o) {
  const L = [];
  L.push('---', `name: ${o.slug}`, `version: ${o.version}`, `status: ${o.status}`, `domain: ${o.domain}`, `path: ${o.path}`, '---', '');
  L.push(`# ${o.title}`, '');
  L.push(wrap('The rendered view of [`recipe.json`](recipe.json). When the two disagree, the JSON is right and this file is stale.'), '');
  L.push(wrap(`**Need.** ${o.description.need}`), '');
  L.push(wrap(`**Input.** ${o.description.input}`), '');
  L.push(wrap(`**Core action.** ${o.description.core_action}`), '');
  L.push(wrap(`**Output.** ${o.description.output}`), '');
  L.push('## Activities', '');
  o.activities.forEach((a, i) => L.push(wrap(`${i + 1}. ${a.label} *(${a.kind})*`)));
  L.push('', wrap('Linear and branch-free, by contract. This is the shape of the work, not a runbook.'), '');
  L.push('## Outcomes', '');
  for (const oc of o.outcomes) {
    L.push(wrap(`**${oc.statement}**`), '');
    if (oc.success_criteria && oc.success_criteria.length) L.push(bullets(oc.success_criteria), '');
  }
  L.push('## Guidance', '', wrap(o.guidance), '');
  L.push('## Where this is worth adopting', '');
  L.push(o.use_cases && o.use_cases.length ? bullets(o.use_cases) : '_(not written yet - the gate fails until they are)_', '');
  L.push('## Connector types', '');
  if (o.connector_types.length) {
    L.push(wrap(`${o.connector_types.map((c) => '`' + c + '`').join(', ')}.`), '');
    L.push(wrap('Types, never connectors. Adoption resolves each to any connector whose catalog `categories` include it, and the concrete knowledge lives in [`examples/`](examples/).'), '');
  } else {
    L.push(wrap(NO_CONNECTOR), '');
  }
  L.push('## Recommended trigger', '');
  L.push(wrap(`\`${o.recommended_trigger.kind}\`. ${o.recommended_trigger.rationale || ''}`), '');
  L.push(wrap('A recommendation is a default, not a binding: the adopter assigns the real trigger at adoption or later.'), '');
  if (o.personalization_needs && o.personalization_needs.length) {
    L.push('', '## Personalization needs', '', bullets(o.personalization_needs), '');
  }
  L.push('', '## Dependencies', '', o.dependencies && o.dependencies.length ? bullets(o.dependencies) : 'None.', '');
  return L.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

const lessonsSeed = (o) => [
  `# Lessons - ${o.slug}`,
  '',
  'Append-only. One block per run, newest last, in the lane format:',
  '',
  '```markdown',
  '## <version used> - <YYYY-MM-DD> - <project>',
  '- What the run taught, in bullets.',
  '```',
  '',
  'The version slot records the version the run **used**, not the bump it argues for.',
  'Appending here does not require a version bump: a lesson records a run against a',
  'version, it is not a change to the method.',
  '',
  'Only lessons that **generalize** belong here. A lesson naming a credential, an account,',
  'a file path or a person is charter memory and stays in the consuming application.',
  '',
  'No entries yet. This recipe is `seed`: it has not been run enough to have earned one,',
  'and an invented entry would be worse than an empty file.',
  '',
].join('\n');

const dirFor = (o) => path.join(LANE, o.domain, o.path.split('/')[1], o.slug);

const readJson = (slug) => {
  const p = get(slug);
  const f = path.join(dirFor(p), 'recipe.json');
  if (!fs.existsSync(f)) die(`${f} does not exist - run \`scaffold ${slug}\` first`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
};

const [, , cmd, arg] = process.argv;

if (cmd === 'show') {
  console.log(JSON.stringify(get(arg), null, 2));
} else if (cmd === 'scaffold') {
  const o = toRegistry(get(arg));
  const dir = dirFor(o);
  if (fs.existsSync(path.join(dir, 'recipe.json'))) die(`${dir} already scaffolded - edit it, do not re-scaffold`);
  fs.mkdirSync(path.join(dir, 'examples'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'recipe.json'), JSON.stringify(o, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'LESSONS.md'), lessonsSeed(o), 'utf8');
  fs.writeFileSync(path.join(dir, 'RECIPE.md'), renderMd(o), 'utf8');
  console.log(`scaffolded ${path.relative(REGISTRY, dir).replace(/\\/g, '/')}`);
  console.log('use_cases is EMPTY and the gate fails until you write 3-6. That is the point.');
} else if (cmd === 'render') {
  const o = readJson(arg);
  fs.writeFileSync(path.join(dirFor(o), 'RECIPE.md'), renderMd(o), 'utf8');
  console.log(`rendered RECIPE.md for ${arg}`);
} else if (cmd === 'status') {
  let done = 0;
  let todo = 0;
  for (const lane of lanes.lanes) {
    if (arg && lane.id !== arg) continue;
    const missing = lane.recipes.filter((r) => !fs.existsSync(path.join(LANE, r.path, r.slug, 'recipe.json')));
    const empty = lane.recipes.filter((r) => {
      const f = path.join(LANE, r.path, r.slug, 'recipe.json');
      if (!fs.existsSync(f)) return false;
      try { return (JSON.parse(fs.readFileSync(f, 'utf8')).use_cases || []).length === 0; } catch { return true; }
    });
    const ok = lane.count - missing.length - empty.length;
    done += ok;
    todo += missing.length + empty.length;
    console.log(`${lane.id}  ${String(ok).padStart(2)}/${lane.count} complete`
      + (missing.length ? `  missing: ${missing.map((r) => r.slug).join(' ')}` : '')
      + (empty.length ? `  no use_cases: ${empty.map((r) => r.slug).join(' ')}` : ''));
  }
  console.log(`\ntotal ${done} complete, ${todo} outstanding`);
} else {
  console.log('usage: rx.mjs show|scaffold|render <slug> | status [lane-id]');
  process.exit(1);
}
