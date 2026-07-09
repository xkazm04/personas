#!/usr/bin/env node
/**
 * Validate + merge translator-subagent output back into src/i18n/locales/*.json.
 *
 * Reads every task from .i18n-work/index.json, expects a sibling result at
 * .i18n-work/out/<lang>/<same-name> mapping the SAME keys to translated values.
 *
 * A chunk is REJECTED (and its keys left untouched) if it:
 *   - is missing / invalid JSON
 *   - drops or invents a key
 *   - breaks placeholder parity ({count} must survive byte-identical)
 *   - returns an empty value
 *   - returns the English string verbatim (that was the bug we came to fix)
 *
 * Rejections are reported per chunk and the script exits non-zero WITHOUT
 * writing, unless --partial is passed (merge the good chunks, list the bad).
 *
 * Usage:
 *   node scripts/i18n/merge-chunks.mjs            # all-or-nothing
 *   node scripts/i18n/merge-chunks.mjs --partial  # merge what passed
 *   node scripts/i18n/merge-chunks.mjs --report   # validate only, write nothing
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import {
  LOCDIR,
  readCatalog,
  placeholders,
  isTranslatable,
  loadAllowlist,
  hasICU,
} from './lib/untranslated.mjs';

const argv = process.argv.slice(2);
const partial = argv.includes('--partial');
const reportOnly = argv.includes('--report');
const WORK = '.i18n-work';

const { tasks } = JSON.parse(fs.readFileSync(`${WORK}/index.json`, 'utf8'));
const en = readCatalog('en');

const accepted = {}; // lang -> { key: value }
const allowlist = new Set(loadAllowlist()); // "<lang>:<key>" deliberately kept English
const icuQuarantined = new Set(); // en.json keys whose ICU must be fixed before translating
const problems = [];
let okChunks = 0;

for (const t of tasks) {
  const outFile = t.file.replace(`${WORK}/gaps/`, `${WORK}/out/`);
  const label = `${t.lang}/${t.file.split("/").pop().replace(".json","")}`;
  if (!fs.existsSync(outFile)) {
    problems.push(`${label}: no output file`);
    continue;
  }
  let tr;
  try {
    tr = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } catch (e) {
    problems.push(`${label}: invalid JSON (${e.message})`);
    continue;
  }
  // Tolerate agents that wrapped the map in {strings:{…}}.
  if (tr.strings && typeof tr.strings === 'object') tr = tr.strings;

  // A correct translation may legitimately equal the English source ("Import",
  // "Status", "Monitor" in German). Accepting that silently would also let a
  // lazy agent echo the input back; rejecting it outright would corrupt good
  // work. So the agent must DECLARE each such key in __keep_english — intent,
  // not coincidence — and those keys land in the gate's allowlist.
  const keepEnglish = Array.isArray(tr.__keep_english) ? tr.__keep_english : [];
  delete tr.__keep_english;

  const srcAll = JSON.parse(fs.readFileSync(t.file, 'utf8')).strings;
  // Quarantine: 8 en.json values carry ICU syntax the runtime cannot render.
  // Translating them faithfully would replicate the bug into 13 locales; the
  // English must be fixed first. Skip, don't merge, and report at the end.
  const src = Object.fromEntries(Object.entries(srcAll).filter(([, v]) => !hasICU(v)));
  for (const k of Object.keys(srcAll)) if (hasICU(srcAll[k])) icuQuarantined.add(k);

  const want = Object.keys(src);
  const got = new Set(Object.keys(tr));

  const missing = want.filter((k) => !got.has(k));
  const extra = [...got].filter((k) => !(k in srcAll));
  const empty = want.filter((k) => got.has(k) && !String(tr[k] ?? '').trim());
  const phBad = want.filter((k) => got.has(k) && placeholders(src[k]) !== placeholders(tr[k]));
  const icuOut = want.filter((k) => got.has(k) && hasICU(tr[k]));
  const stillEn = want.filter(
    (k) => got.has(k) && isTranslatable(src[k]) && String(tr[k]) === String(src[k]),
  );
  const undeclared = stillEn.filter((k) => !keepEnglish.includes(k));

  const errs = [];
  if (missing.length) errs.push(`missing ${missing.length} (${missing.slice(0, 2).join(', ')})`);
  if (extra.length) errs.push(`extra ${extra.length} (${extra.slice(0, 2).join(', ')})`);
  if (empty.length) errs.push(`empty ${empty.length} (${empty.slice(0, 2).join(', ')})`);
  if (phBad.length) errs.push(`placeholder-break ${phBad.length} (${phBad.slice(0, 2).join(', ')})`);
  if (icuOut.length) errs.push(`ICU in output ${icuOut.length} (${icuOut.slice(0, 2).join(', ')})`);
  if (undeclared.length)
    errs.push(`undeclared still-English ${undeclared.length} (${undeclared.slice(0, 2).join(', ')})`);
  // An agent that "keeps" a quarter of its chunk in English did not do the work.
  if (keepEnglish.length > Math.max(4, want.length * 0.25))
    errs.push(`__keep_english too large (${keepEnglish.length}/${want.length})`);

  if (errs.length) {
    problems.push(`${label}: ${errs.join(' · ')}`);
    continue;
  }
  (accepted[t.lang] ||= {});
  for (const k of want) accepted[t.lang][k] = tr[k];
  for (const k of keepEnglish) if (want.includes(k)) allowlist.add(`${t.lang}:${k}`);
  okChunks++;
}

console.log(`chunks accepted : ${okChunks}/${tasks.length}`);
console.log(`strings accepted: ${Object.values(accepted).reduce((a, m) => a + Object.keys(m).length, 0)}`);
if (icuQuarantined.size) {
  console.log(`\nICU-quarantined en.json keys (fix the English, then retranslate): ${icuQuarantined.size}`);
  [...icuQuarantined].sort().forEach((k) => console.log(`  ⚠ ${k}`));
}
if (problems.length) {
  console.log(`\nchunks rejected : ${problems.length}`);
  problems.slice(0, 40).forEach((p) => console.log(`  ✗ ${p}`));
  if (problems.length > 40) console.log(`  … ${problems.length - 40} more`);
}

if (reportOnly) process.exit(problems.length ? 1 : 0);
if (problems.length && !partial) {
  console.error('\nRefusing to merge — re-run the rejected chunks, or pass --partial.');
  process.exit(1);
}

function deepSet(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof cur[p] !== 'object' || cur[p] === null || Array.isArray(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

for (const [lang, map] of Object.entries(accepted)) {
  const file = `${LOCDIR}/${lang}.json`;
  const cat = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [k, v] of Object.entries(map)) deepSet(cat, k, v);
  fs.writeFileSync(file, JSON.stringify(cat, null, 2) + '\n');
  console.log(`  ${lang.padEnd(4)} merged ${Object.keys(map).length}`);
}

if (allowlist.size) {
  fs.mkdirSync('docs/i18n', { recursive: true });
  fs.writeFileSync(
    'docs/i18n/untranslated-allowlist.json',
    JSON.stringify([...allowlist].sort(), null, 2) + '\n',
  );
  console.log(`\nallowlist: ${allowlist.size} values deliberately identical to English`);
}

console.log('\nRe-splitting section-locales…');
execSync('node scripts/i18n/split-locales.mjs', { stdio: 'inherit' });
console.log('\nVerifying key parity…');
execSync('node scripts/i18n/check-coverage.mjs --strict', { stdio: 'inherit' });
console.log('\nVerifying no untranslated values…');
execSync(`node scripts/i18n/check-untranslated.mjs${partial ? '' : ' --strict'}`, { stdio: 'inherit' });
