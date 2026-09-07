#!/usr/bin/env node
// Merges the App Master recipes in this directory into scripts/templates/_recipe_seeds.json
// as seed rows owned by the virtual template `app-master` (no template file exists on
// purpose: these recipes are adopted headlessly, never through a preset).
//
// Idempotent: a row with the same `id` is replaced, otherwise appended; `recipe_count` is
// kept in step. Refuses to write unless its serialization round-trips the current bundle
// byte for byte, so it can never reformat the file under another script.
//
//   node scripts/templates/_app_master/merge-into-bundle.mjs
//   then: node scripts/templates/generate-recipe-index.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const SEEDS = path.join(ROOT, 'scripts', 'templates', '_recipe_seeds.json');
const OWNER = 'app-master';

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

const files = fs.readdirSync(HERE).filter((f) => f.endsWith('.json'));
if (files.length === 0) {
  // "Looked at nothing" must not exit 0 as if it had merged something.
  console.error(`refusing: no recipe files found in ${HERE}`);
  process.exit(1);
}
let added = 0, replaced = 0;
for (const f of files) {
  const p = JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));
  if (p.status !== 'draft' || 'version' in p) {
    console.error(`refusing ${f}: starting-line contract is status draft with no version`);
    process.exit(1);
  }
  const row = {
    id: p.id,
    source_template_id: OWNER,
    source_use_case_id: p.slug,
    source_use_case_name: p.title,
    source_version: '1.0.0',
    name: p.title,
    description: [p.description?.need, p.description?.coreAction].filter(Boolean).join(' '),
    category: 'development',
    prompt_template: JSON.stringify(p),
    tool_requirements: null,
    tags: JSON.stringify([OWNER, 'software_engineering']),
  };
  const i = bundle.recipes.findIndex((r) => r.id === row.id);
  if (i >= 0) { bundle.recipes[i] = row; replaced += 1; } else { bundle.recipes.push(row); added += 1; }
}
bundle.recipe_count = bundle.recipes.length;
fs.writeFileSync(SEEDS, serialize(bundle), 'utf8');
console.log(`merged ${files.length} recipes (${added} added, ${replaced} replaced); bundle now ${bundle.recipe_count}`);
