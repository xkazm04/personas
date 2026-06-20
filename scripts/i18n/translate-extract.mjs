#!/usr/bin/env node
/**
 * i18n translation pipeline — STEP 1 of 3: EXTRACT.
 *
 * Computes the set of keys present in `en.json` but missing from any
 * non-English locale, and writes them as a flat work file ready to hand to
 * translator subagents. Closes the "English mixed into a translated UI" gap
 * that opens whenever a feature adds en.json keys without translating them.
 *
 * Full flow (run from the repo root):
 *   1. node scripts/i18n/translate-extract.mjs
 *        → writes .i18n-work/missing-en.json  (translatable key → English value)
 *          and    .i18n-work/_meta-keys.json  (_comment notes, copied verbatim)
 *   2. Spawn ONE Sonnet subagent per non-English locale. Each reads
 *      .i18n-work/missing-en.json, translates every VALUE into its language
 *      (preserve {placeholders}; keep brand/technical terms; handle plural
 *      variants; concise UI register; medium quality is fine), and WRITES
 *      .i18n-work/missing-<code>.json with the SAME keys.
 *   3. node scripts/i18n/translate-merge.mjs
 *        → validates + merges each into src/i18n/locales/<code>.json,
 *          re-splits section-locales, and asserts `check:i18n --strict` is clean.
 *
 * The .i18n-work/ dir is gitignored scratch space; translate-merge cleans it.
 */
import fs from 'node:fs';

const LOCDIR = 'src/i18n/locales';
const OUTDIR = process.argv[2] || '.i18n-work';

function flatten(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, v);
  }
}

const codes = fs
  .readdirSync(LOCDIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));
const nonEn = codes.filter((c) => c !== 'en').sort();

const en = new Map();
flatten(JSON.parse(fs.readFileSync(`${LOCDIR}/en.json`, 'utf8')), '', en);

const missing = new Set();
for (const lang of nonEn) {
  const m = new Map();
  flatten(JSON.parse(fs.readFileSync(`${LOCDIR}/${lang}.json`, 'utf8')), '', m);
  for (const k of en.keys()) if (!m.has(k)) missing.add(k);
}

const all = [...missing].sort();
// _comment* segments are translator notes, never rendered — copy verbatim.
const isComment = (k) => k.split('.').some((seg) => seg.startsWith('_comment'));
const translatable = all.filter((k) => !isComment(k));
const commentKeys = all.filter(isComment);

if (all.length === 0) {
  console.log('✓ No translation gap — every non-English locale already covers en.json.');
  process.exit(0);
}

fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(
  `${OUTDIR}/missing-en.json`,
  JSON.stringify(Object.fromEntries(translatable.map((k) => [k, en.get(k)])), null, 2),
);
fs.writeFileSync(
  `${OUTDIR}/_meta-keys.json`,
  JSON.stringify(Object.fromEntries(commentKeys.map((k) => [k, en.get(k)])), null, 2),
);

const bySec = {};
for (const k of translatable) {
  const s = k.split('.')[0];
  bySec[s] = (bySec[s] || 0) + 1;
}
console.log(`Translation gap: ${all.length} keys missing across ${nonEn.length} locale(s) (${nonEn.join(', ')}).`);
console.log(`  ${translatable.length} translatable  +  ${commentKeys.length} _comment/meta (verbatim)`);
console.log('\nBy section:');
for (const [s, n] of Object.entries(bySec).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${s}`);
}
console.log(`\nWrote ${OUTDIR}/missing-en.json  +  ${OUTDIR}/_meta-keys.json`);
console.log('\nNext: spawn one Sonnet subagent per locale to translate missing-en.json →');
console.log(`  ${nonEn.map((c) => `${OUTDIR}/missing-${c}.json`).join(', ')}`);
console.log('then run:  node scripts/i18n/translate-merge.mjs');
