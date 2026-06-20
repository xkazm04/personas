#!/usr/bin/env node
/**
 * i18n translation pipeline — STEP 3 of 3: MERGE + VERIFY.
 *
 * Reads the per-locale translation files produced by the translator subagents
 * (.i18n-work/missing-<code>.json), validates each, deep-merges them into
 * src/i18n/locales/<code>.json (copying _comment/meta keys verbatim), then
 * re-splits the section-locale chunks the runtime loads and asserts the
 * coverage gate is clean. See translate-extract.mjs for the full flow.
 *
 * Exit non-zero (so it can gate a script) if any locale's translation file is
 * absent/invalid, drops/duplicates keys, or breaks a placeholder.
 *
 * Usage: node scripts/i18n/translate-merge.mjs [workdir]   (default .i18n-work)
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const LOCDIR = 'src/i18n/locales';
const WORK = process.argv[2] || '.i18n-work';

if (!fs.existsSync(`${WORK}/missing-en.json`)) {
  console.error(`No ${WORK}/missing-en.json — run translate-extract.mjs first.`);
  process.exit(1);
}
const enMap = JSON.parse(fs.readFileSync(`${WORK}/missing-en.json`, 'utf8'));
const srcKeys = Object.keys(enMap);
const metaEn = fs.existsSync(`${WORK}/_meta-keys.json`)
  ? JSON.parse(fs.readFileSync(`${WORK}/_meta-keys.json`, 'utf8'))
  : {};

const nonEn = fs
  .readdirSync(LOCDIR)
  .filter((f) => f.endsWith('.json') && f !== 'en.json')
  .map((f) => f.replace(/\.json$/, ''));

function deepSet(obj, dotkey, value) {
  const parts = dotkey.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof cur[p] !== 'object' || cur[p] === null || Array.isArray(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}
const phSet = (s) => (String(s).match(/\{[^}]+\}/g) || []).sort().join(',');

let failed = false;
const lines = [];
for (const lang of nonEn) {
  const f = `${WORK}/missing-${lang}.json`;
  if (!fs.existsSync(f)) { lines.push(`${lang}: ✗ no translation file`); failed = true; continue; }
  let tr;
  try { tr = JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { lines.push(`${lang}: ✗ invalid JSON (${e.message})`); failed = true; continue; }

  const trKeys = new Set(Object.keys(tr));
  const missing = srcKeys.filter((k) => !trKeys.has(k));
  const phBad = srcKeys.filter((k) => trKeys.has(k) && phSet(enMap[k]) !== phSet(tr[k]));
  if (missing.length) { lines.push(`${lang}: ✗ missing ${missing.length} keys (${missing.slice(0, 3).join(', ')})`); failed = true; continue; }
  if (phBad.length) { lines.push(`${lang}: ✗ placeholder break in ${phBad.length} (${phBad.slice(0, 3).join(', ')})`); failed = true; continue; }

  const loc = JSON.parse(fs.readFileSync(`${LOCDIR}/${lang}.json`, 'utf8'));
  for (const k of srcKeys) deepSet(loc, k, tr[k]);
  for (const [k, v] of Object.entries(metaEn)) deepSet(loc, k, v);
  fs.writeFileSync(`${LOCDIR}/${lang}.json`, JSON.stringify(loc, null, 2) + '\n');
  lines.push(`${lang}: ✓ merged ${srcKeys.length} + ${Object.keys(metaEn).length} meta`);
}
console.log(lines.join('\n'));

if (failed) {
  console.error('\nMerge aborted for the locale(s) above — fix/re-run their subagent, then re-run this script.');
  process.exit(1);
}

console.log('\nRe-splitting section-locales…');
execSync('node scripts/i18n/split-locales.mjs', { stdio: 'inherit' });
console.log('\nVerifying coverage (strict)…');
execSync('node scripts/i18n/check-coverage.mjs --strict', { stdio: 'inherit' });

fs.rmSync(WORK, { recursive: true, force: true });
console.log(`\n✓ Translations merged, section-locales regenerated, coverage clean. Removed ${WORK}/.`);
