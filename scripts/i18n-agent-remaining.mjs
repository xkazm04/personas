#!/usr/bin/env node
/**
 * i18n-agent-remaining.mjs
 *
 * For each target language, writes `.planning/i18n/remaining-{lang}.json`
 * containing the subset of missing keys NOT yet translated in
 * `translated-{lang}.json`. This lets resume agents work on focused
 * smaller files instead of re-processing already-done keys.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PLANNING = resolve(ROOT, '.planning/i18n');

const ALL_LANGS = ['ar', 'bn', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'ko', 'ru', 'vi', 'zh'];

const missingEn = JSON.parse(readFileSync(resolve(PLANNING, 'missing-en.json'), 'utf-8'));
const totalMissing = Object.keys(missingEn).length;
console.log(`Source: ${totalMissing} missing keys\n`);

for (const lang of ALL_LANGS) {
  const path = resolve(PLANNING, `translated-${lang}.json`);
  const done = existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : {};
  const doneKeys = new Set(Object.keys(done));

  const remaining = {};
  for (const [k, v] of Object.entries(missingEn)) {
    if (!doneKeys.has(k)) remaining[k] = v;
  }

  const remainingCount = Object.keys(remaining).length;
  const outPath = resolve(PLANNING, `remaining-${lang}.json`);

  if (remainingCount === 0) {
    console.log(`  ${lang}: ✅ complete (${Object.keys(done).length}/${totalMissing})`);
  } else {
    writeFileSync(outPath, JSON.stringify(remaining, null, 2), 'utf-8');
    console.log(`  ${lang}: ${remainingCount} remaining → ${outPath}`);
  }
}
