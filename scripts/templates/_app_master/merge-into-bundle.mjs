#!/usr/bin/env node
// Merges a directory of headless-role recipes into scripts/templates/_recipe_seeds.json
// as seed rows owned by a virtual template (no template file exists on purpose: these
// recipes are adopted headlessly, never through a preset).
//
// Idempotent: a row with the same `id` is replaced, otherwise appended; `recipe_count` is
// kept in step. Refuses to write unless its serialization round-trips the current bundle
// byte for byte, so it can never reformat the file under another script.
//
//   node scripts/templates/_app_master/merge-into-bundle.mjs
//   node scripts/templates/_app_master/merge-into-bundle.mjs --dir scripts/templates/_architect --owner architect
//   then: node scripts/templates/generate-recipe-index.mjs
//
// `--dir` and `--owner` were added for the Architect (the Grand Simulation's
// cross-project role, `scripts/templates/_architect/`). Before them this script read
// `HERE` and stamped `OWNER = 'app-master'` as constants, and the _architect README's
// stated merge path was "a copy of that script placed here with OWNER = 'architect'" —
// a second copy of a merge that has to stay in step with the bundle's format contract.
// The DEFAULTS are unchanged: with no flags this is byte-for-byte the same merge it was.
//
// `category` and `tags` are derived from each payload's own `domain` rather than
// hardcoded to development/software_engineering. For every recipe that has ever been
// merged (both App Master ones) that yields exactly the values already in the bundle;
// it starts mattering for the Architect, three of whose five are `general_professional`
// and would otherwise be filed under a domain they do not belong to.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { exploreCategoryFor } from '../_domain-categories.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const SEEDS = path.join(ROOT, 'scripts', 'templates', '_recipe_seeds.json');

/** One `--flag value` pair, or the fallback when the flag is absent. */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) {
    console.error(`refusing: --${name} needs a value`);
    process.exit(1);
  }
  return v;
}

// Default: this script's own directory and the App Master owner — what the two
// constants used to be.
const DIR = path.resolve(ROOT, arg('dir', HERE));
const OWNER = arg('owner', 'app-master');

if (!fs.existsSync(DIR) || !fs.statSync(DIR).isDirectory()) {
  console.error(`refusing: --dir ${DIR} is not a directory`);
  process.exit(1);
}

const raw = fs.readFileSync(SEEDS, 'utf8');
const bundle = JSON.parse(raw);
const serialize = (b) => JSON.stringify(b, null, 2) + '\n';
if (serialize(bundle) !== raw.replace(/\r\n/g, '\n')) {
  console.error('refusing: my serialization does not round-trip the bundle; format drifted');
  process.exit(1);
}
if (bundle.version !== 3) {
  console.error(`refusing: bundle version ${bundle.version}, expected 3`);
  process.exit(1);
}

// The merge script itself lives in one of these directories, so a `.mjs` is not a
// recipe — only `.json` is read, and an empty read is a refusal, never a green exit.
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
if (files.length === 0) {
  // "Looked at nothing" must not exit 0 as if it had merged something.
  console.error(`refusing: no recipe files found in ${DIR}`);
  process.exit(1);
}
let added = 0, replaced = 0;
for (const f of files) {
  const p = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (p.status !== 'draft' || 'version' in p) {
    console.error(`refusing ${f}: starting-line contract is status draft with no version`);
    process.exit(1);
  }
  const domain = typeof p.domain === 'string' && p.domain.trim() ? p.domain.trim() : 'software_engineering';
  const row = {
    id: p.id,
    source_template_id: OWNER,
    source_use_case_id: p.slug,
    source_use_case_name: p.title,
    source_version: '1.0.0',
    name: p.title,
    description: [p.description?.need, p.description?.coreAction].filter(Boolean).join(' '),
    category: exploreCategoryFor(domain),
    prompt_template: JSON.stringify(p),
    tool_requirements: null,
    tags: JSON.stringify([OWNER, domain]),
  };
  const i = bundle.recipes.findIndex((r) => r.id === row.id);
  if (i >= 0) { bundle.recipes[i] = row; replaced += 1; } else { bundle.recipes.push(row); added += 1; }
}
bundle.recipe_count = bundle.recipes.length;
fs.writeFileSync(SEEDS, serialize(bundle), 'utf8');
console.log(`merged ${files.length} recipes from ${path.relative(ROOT, DIR)} as \`${OWNER}\` (${added} added, ${replaced} replaced); bundle now ${bundle.recipe_count}`);
