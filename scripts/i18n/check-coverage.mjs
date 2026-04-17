#!/usr/bin/env node
/**
 * CI gate: fails if any locale in `src/i18n/locales/*.json` has a
 * different keyset than `en.json`. Every locale must ship a full
 * translation — there is no runtime English fallback.
 *
 * Exit codes:
 *   0  all locales match en
 *   1  one or more locales have missing / extra keys
 *
 * Usage:
 *   node scripts/i18n/check-coverage.mjs
 *   node scripts/i18n/check-coverage.mjs --json     # machine-readable
 *
 * Run in CI via `npm run check:i18n`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const LOCALES_DIR = resolve(ROOT, 'src/i18n/locales');

const asJson = process.argv.includes('--json');

function flattenKeys(obj, prefix = '') {
  const out = new Set();
  if (obj === null || typeof obj !== 'object') {
    out.add(prefix);
    return out;
  }
  if (Array.isArray(obj)) {
    // Treat arrays as leaf values for coverage purposes.
    out.add(prefix);
    return out;
  }
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const nested of flattenKeys(value, path)) out.add(nested);
    } else {
      out.add(path);
    }
  }
  return out;
}

function loadLocale(code) {
  const raw = readFileSync(resolve(LOCALES_DIR, `${code}.json`), 'utf8');
  return JSON.parse(raw);
}

const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
const codes = files.map((f) => f.replace(/\.json$/, '')).sort();

if (!codes.includes('en')) {
  console.error('FATAL: src/i18n/locales/en.json not found');
  process.exit(1);
}

const enKeys = flattenKeys(loadLocale('en'));

const report = {
  source: 'en',
  sourceKeyCount: enKeys.size,
  locales: [],
};

let hasDrift = false;

for (const code of codes) {
  if (code === 'en') continue;
  const localeKeys = flattenKeys(loadLocale(code));
  const missing = [...enKeys].filter((k) => !localeKeys.has(k));
  const extra = [...localeKeys].filter((k) => !enKeys.has(k));
  if (missing.length || extra.length) hasDrift = true;
  report.locales.push({
    code,
    keyCount: localeKeys.size,
    missing: missing.length,
    extra: extra.length,
    missingKeys: missing,
    extraKeys: extra,
  });
}

if (asJson) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  console.log(`i18n coverage check — ${enKeys.size} keys in en.json\n`);
  console.log('Lang  | Keys   | Missing | Extra');
  console.log('------|--------|---------|------');
  for (const loc of report.locales) {
    const status = loc.missing || loc.extra ? '✗' : '✓';
    console.log(
      `${loc.code.padEnd(5)} | ${String(loc.keyCount).padStart(6)} | ${String(loc.missing).padStart(7)} | ${String(loc.extra).padStart(5)} ${status}`,
    );
  }

  if (hasDrift) {
    console.log('\n--- Drift detail ---');
    for (const loc of report.locales) {
      if (!loc.missing && !loc.extra) continue;
      console.log(`\n[${loc.code}]`);
      if (loc.missing) {
        console.log(`  Missing (${loc.missing}):`);
        for (const k of loc.missingKeys.slice(0, 20)) console.log(`    - ${k}`);
        if (loc.missingKeys.length > 20) console.log(`    … and ${loc.missingKeys.length - 20} more`);
      }
      if (loc.extra) {
        console.log(`  Extra  (${loc.extra}):`);
        for (const k of loc.extraKeys.slice(0, 20)) console.log(`    + ${k}`);
        if (loc.extraKeys.length > 20) console.log(`    … and ${loc.extraKeys.length - 20} more`);
      }
    }
  }
}

if (hasDrift) {
  console.error('\nFAIL: one or more locales have drifted from en.json.');
  process.exit(1);
}
