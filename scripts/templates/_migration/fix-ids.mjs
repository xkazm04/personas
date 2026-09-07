#!/usr/bin/env node
// Backfill the registry `id` with the seed row's stable uuid.
//
// Every seed row carries two ids: the row uuid (unique, the v2 corpus key) and the
// payload's internal graph key (`uc_triage`, `uc_intake`, `uc_weekly_digest`), which
// repeats across recipes. rx.mjs originally copied the second, so 101 of 102 migrated
// recipes carried a non-uuid id and five ids were duplicated across eleven recipes.
// The lane agents were right to refuse to invent one; this takes the real one.
// Idempotent: run it as often as you like.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const LANE = path.join(process.env.AI_REGISTRY || 'C:/Users/kazda/kiro/ai-registry', 'recipes');
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/templates/_recipe_seeds.json'), 'utf8'));
const bySlug = new Map();
for (const row of bundle.recipes) { const p = JSON.parse(row.prompt_template); if (p.slug) bySlug.set(p.slug, row.id); }
let fixed = 0, ok = 0, unknown = [];
for (const domain of fs.readdirSync(LANE, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  for (const topic of fs.readdirSync(path.join(LANE, domain.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const slug of fs.readdirSync(path.join(LANE, domain.name, topic.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const file = path.join(LANE, domain.name, topic.name, slug.name, 'recipe.json');
      if (!fs.existsSync(file)) continue;
      const want = bySlug.get(slug.name);
      if (!want) { unknown.push(slug.name); continue; }
      const raw = fs.readFileSync(file, 'utf8');
      const o = JSON.parse(raw);
      if (o.id === want) { ok += 1; continue; }
      o.id = want;
      fs.writeFileSync(file, JSON.stringify(o, null, 2) + '\n', 'utf8');
      fixed += 1;
    }
  }
}
console.log(`ids: ${fixed} rewritten, ${ok} already correct` + (unknown.length ? `, not in the bundle (left alone): ${unknown.join(' ')}` : ''));
