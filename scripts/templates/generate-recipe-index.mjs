#!/usr/bin/env node
// Generates src/features/templates/sub_explore/recipeIndex.generated.json from
// scripts/templates/_recipe_seeds.json.
//
// Until 2026-09-06 this file had NO generator anywhere in the repo: it was a
// Python json.dumps artifact whose `tags` field had been truncated to six
// characters (`"[\"acce`), and the Explore catalog typed that field as
// `string[]` while receiving a broken string at runtime. This script is the
// generator, and it emits `tags` as a real array.
//
// The Explore catalog groups recipes through exploreDomains.ts, whose
// CATEGORY_TO_DOMAIN map understands the OLD per-template categories
// (development, sales, content, ...), not the v3 closed domain families
// (software_engineering, sales_marketing, ...). `category` is therefore emitted
// as the nearest explore category so grouping keeps working, and the v3
// `domain` + `path` ride beside it for readers that want the real taxonomy.
//
// Deterministic: sorted by id, LF endings, no timestamps. `--check` verifies
// the committed file matches (exit 1 on drift) and is what CI should run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { exploreCategoryFor } from './_domain-categories.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SEEDS = path.join(ROOT, 'scripts', 'templates', '_recipe_seeds.json');
const OUT = path.join(ROOT, 'src', 'features', 'templates', 'sub_explore', 'recipeIndex.generated.json');

// The v3 domain family -> explore category map moved to `_domain-categories.mjs`
// when `merge-into-bundle.mjs` became its second reader: the merge files a seed
// row under a category, this generator shows it under one, and two copies of the
// table is how those two answers start to differ.

function parseTags(raw) {
  if (Array.isArray(raw)) return raw.filter((t) => typeof t === 'string');
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function build() {
  const bundle = JSON.parse(fs.readFileSync(SEEDS, 'utf8'));
  if (bundle.version !== 3) {
    throw new Error(`expected a version-3 seed bundle, found version ${bundle.version}`);
  }
  const rows = bundle.recipes.map((seed) => {
    const p = JSON.parse(seed.prompt_template);
    const domain = typeof p.domain === 'string' ? p.domain : '';
    const category = exploreCategoryFor(domain);
    const description = p.description && typeof p.description === 'object'
      ? [p.description.need, p.description.coreAction].filter(Boolean).join(' ')
      : (seed.description ?? '');
    return {
      id: seed.id,
      name: p.title ?? seed.name,
      description,
      category,
      domain,
      path: typeof p.path === 'string' ? p.path : '',
      sourceTemplateId: seed.source_template_id ?? null,
      tags: parseTags(seed.tags),
      toolCount: Array.isArray(seed.tool_requirements) ? seed.tool_requirements.length : 0,
      connectorTypes: Array.isArray(p.connectorTypes) ? p.connectorTypes : [],
      recommendedTrigger: p.recommendedTrigger?.kind ?? null,
      version: p.version ?? null,
      status: p.status ?? null,
    };
  });
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(rows, null, 2) + '\n';
}

const check = process.argv.includes('--check');
const next = build();
if (check) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== next) {
    console.error(`recipe index is stale: run \`node scripts/templates/generate-recipe-index.mjs\` (${OUT})`);
    process.exit(1);
  }
  console.log(`recipe index is current (${JSON.parse(next).length} recipes)`);
} else {
  fs.writeFileSync(OUT, next, 'utf8');
  console.log(`wrote ${path.relative(ROOT, OUT)} (${JSON.parse(next).length} recipes)`);
}
