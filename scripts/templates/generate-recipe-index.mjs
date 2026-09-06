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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SEEDS = path.join(ROOT, 'scripts', 'templates', '_recipe_seeds.json');
const OUT = path.join(ROOT, 'src', 'features', 'templates', 'sub_explore', 'recipeIndex.generated.json');

// v3 domain family -> the explore category exploreDomains.ts already maps.
// Families with no explore home land on 'operations', which is that file's
// own documented catch-all, so nothing is orphaned.
const DOMAIN_TO_EXPLORE_CATEGORY = {
  software_engineering: 'development',
  data_ai: 'analytics',
  product_project: 'project_management',
  sales_marketing: 'marketing',
  creative_design: 'content',
  finance_accounting: 'finance',
  general_professional: 'productivity',
  operations_logistics: 'operations',
  customer_support: 'operations',
  legal_compliance: 'operations',
  hr_people: 'operations',
  education_academic: 'content',
  life_sciences_research: 'research',
  healthcare_clinical: 'operations',
  skilled_trades: 'operations',
  frontline_service: 'operations',
};

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
    const category = DOMAIN_TO_EXPLORE_CATEGORY[domain] ?? 'operations';
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
