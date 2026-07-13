#!/usr/bin/env node
/**
 * i18n VALUE-level gate: find keys present in a locale but still holding the
 * verbatim English string.
 *
 * Companion to check-coverage.mjs, which only checks KEY parity. A key can exist
 * in every locale and still render English — the runtime `t` Proxy deep-merges
 * English underneath, so nothing warns. This script is the missing half.
 *
 * Modes:
 *   default    report + exit 0 (warn)
 *   --strict   exit 1 if any untranslated value (CI / pre-commit gate)
 *   --json     machine-readable
 *   --full     print every offending key (default samples 10 per locale)
 *   --lang=cs  restrict to one locale
 *
 * Exemptions: docs/i18n/untranslated-allowlist.json — an array of "<lang>:<key>"
 * or "*:<key>" strings for values intentionally identical to English.
 */
import {
  readCatalog,
  locales,
  untranslatedKeys,
  loadAllowlist,
} from './lib/untranslated.mjs';

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const asJson = argv.includes('--json');
const full = argv.includes('--full');
const only = argv.find((a) => a.startsWith('--lang='))?.split('=')[1];

const en = readCatalog('en');
const allow = loadAllowlist();
const langs = only ? [only] : locales();

const report = {};
let total = 0;
for (const lang of langs) {
  const keys = untranslatedKeys(en, readCatalog(lang), lang, allow);
  report[lang] = keys;
  total += keys.length;
}

if (asJson) {
  console.log(JSON.stringify({ total, allowlisted: allow.size, byLang: report }, null, 2));
  process.exit(strict && total ? 1 : 0);
}

const enProse = Object.keys(en).length;
console.log(`i18n untranslated-value check — ${enProse} keys in en.json, ${allow.size} allowlisted\n`);
console.log('Lang  | Untranslated | Sample');
console.log('------|--------------|-------');
for (const lang of langs) {
  const keys = report[lang];
  const mark = keys.length ? '✗' : '✓';
  const sample = keys.length ? keys[0] : '';
  console.log(`${lang.padEnd(5)} | ${String(keys.length).padStart(12)} | ${mark} ${sample}`);
}

if (total) {
  console.log(`\n${total} string-instances still render English in a non-English locale.`);
  for (const lang of langs) {
    const keys = report[lang];
    if (!keys.length) continue;
    const shown = full ? keys : keys.slice(0, 10);
    console.log(`\n  ${lang} (${keys.length}):`);
    shown.forEach((k) => console.log(`    ${k} = ${JSON.stringify(en[k])}`));
    if (!full && keys.length > shown.length) console.log(`    … ${keys.length - shown.length} more (--full)`);
  }
  console.log(`\nFix with the i18n-translate skill: /i18n-translate gaps all`);
} else {
  console.log('\nNo untranslated values. Every locale renders in its own language.');
}

process.exit(strict && total ? 1 : 0);
