#!/usr/bin/env node
/**
 * CI gate for i18n locale keyset health.
 *
 * Two failure modes — treated differently because they have different
 * runtime consequences:
 *
 * - **Extra keys** (locale has a key en.json doesn't) → ALWAYS FAIL.
 *   These are stale: the en.json source-of-truth dropped or renamed the
 *   key, but the translation files still carry it. Stale keys waste
 *   bytes and hide the rename intent. Cheap to fix and useful to gate.
 *
 * - **Missing keys** (en.json has a key the locale doesn't) → WARN, do
 *   NOT fail by default. Missing keys fall back to the English value at
 *   runtime via the deep-merge loader (per CLAUDE.md i18n section).
 *   Translation teams catch up asynchronously; gating new feature work
 *   on completed translations would block development.
 *
 * The `--strict` flag restores the old behavior (fail on either). Run
 * it before a release if you want to assert that translations are
 * caught up.
 *
 * Exit codes:
 *   0  no extras (default mode) / no extras OR missing (--strict mode)
 *   1  any extras (default) / any drift (--strict) / config error
 *
 * Usage:
 *   node scripts/i18n/check-coverage.mjs              # default (extras fail, missing warns)
 *   node scripts/i18n/check-coverage.mjs --strict     # fail on either
 *   node scripts/i18n/check-coverage.mjs --json       # machine-readable
 *
 * Run in CI via `npm run check:i18n`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const LOCALES_DIR = resolve(ROOT, 'src/i18n/locales');

const asJson = process.argv.includes('--json');
const strictMode = process.argv.includes('--strict');

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
let hasExtras = false;

for (const code of codes) {
  if (code === 'en') continue;
  const localeKeys = flattenKeys(loadLocale(code));
  const missing = [...enKeys].filter((k) => !localeKeys.has(k));
  const extra = [...localeKeys].filter((k) => !enKeys.has(k));
  if (missing.length || extra.length) hasDrift = true;
  if (extra.length) hasExtras = true;
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

if (strictMode) {
  if (hasDrift) {
    console.error('\nFAIL (--strict): one or more locales have drifted from en.json.');
    process.exit(1);
  }
} else {
  if (hasExtras) {
    console.error('\nFAIL: one or more locales carry extra keys not present in en.json. Stale keys after a rename or removal — delete them. (Re-run with --strict to also fail on missing keys.)');
    process.exit(1);
  }
  if (hasDrift) {
    console.warn('\nWARN: missing keys in some locales (translation lag). Run with --strict before a release to assert full translation parity.');
  }
}
