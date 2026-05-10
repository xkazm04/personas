#!/usr/bin/env node
/**
 * CI gate for ERROR_KEY_MAP ↔ en.json error_registry parity.
 *
 * `src/i18n/useTranslatedError.ts` declares `ERROR_KEY_MAP` — an array of
 * `{ match, keyPrefix, category }` rules used at runtime to map raw Rust
 * error strings to translated user-facing messages. Each rule's `keyPrefix`
 * MUST have `<keyPrefix>_message` AND `<keyPrefix>_suggestion` keys under
 * `error_registry` in `src/i18n/locales/en.json`. Without those keys, the
 * runtime falls back silently to the raw error string (or to the legacy
 * English-only `resolveError` chain) — the user sees a degraded message
 * and translation teams have no key to translate.
 *
 * This gate parses the keyPrefixes from useTranslatedError.ts via regex
 * and asserts every prefix has both `<prefix>_message` and
 * `<prefix>_suggestion` keys in en.json.
 *
 * Why a regex parse instead of an AST/runtime import:
 *   - The file is hand-maintained, single source of truth for the array,
 *     and the `keyPrefix: '<value>'` shape is stable.
 *   - This script must be a Node-only build gate that doesn't pull in the
 *     project's TypeScript pipeline.
 *
 * Exit codes:
 *   0  every keyPrefix has both message + suggestion in en.json
 *   1  one or more prefixes missing keys (or config error)
 *
 * Usage:
 *   node scripts/i18n/check-error-registry-parity.mjs
 *
 * Architect ADR: see [[Architect/decisions/2026-05-10-error-registry-parity-ci-gate]].
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const SOURCE_FILE = resolve(ROOT, 'src/i18n/useTranslatedError.ts');
const LOCALE_FILE = resolve(ROOT, 'src/i18n/locales/en.json');

function fail(message) {
  console.error(`[check-error-registry-parity] ${message}`);
  process.exit(1);
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    fail(`Cannot read ${path}: ${err.message}`);
  }
}

// Regex matches `keyPrefix: 'value'` or `keyPrefix: "value"` exactly once
// per ERROR_KEY_MAP entry. The single-line shape is enforced by the file's
// formatter — if a future change splits an entry across lines, this regex
// will simply skip that line and the missing prefix will be reported.
const KEY_PREFIX_REGEX = /keyPrefix:\s*['"]([a-zA-Z0-9_]+)['"]/g;

function extractKeyPrefixes(source) {
  const prefixes = [];
  let match;
  while ((match = KEY_PREFIX_REGEX.exec(source)) !== null) {
    prefixes.push(match[1]);
  }
  return prefixes;
}

function parseLocale(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(`Cannot parse en.json: ${err.message}`);
  }
}

const sourceText = readText(SOURCE_FILE);
const prefixes = extractKeyPrefixes(sourceText);

if (prefixes.length === 0) {
  fail(
    `No keyPrefix entries found in ${SOURCE_FILE}. Either ERROR_KEY_MAP was renamed, ` +
      `the regex shape drifted, or the file was unintentionally emptied.`
  );
}

const locale = parseLocale(readText(LOCALE_FILE));
const registry = locale?.error_registry;

if (!registry || typeof registry !== 'object') {
  fail(`en.json has no top-level 'error_registry' object`);
}

const missing = [];

for (const prefix of prefixes) {
  const messageKey = `${prefix}_message`;
  const suggestionKey = `${prefix}_suggestion`;
  const missingHere = [];
  if (typeof registry[messageKey] !== 'string') missingHere.push(messageKey);
  if (typeof registry[suggestionKey] !== 'string') missingHere.push(suggestionKey);
  if (missingHere.length > 0) {
    missing.push({ prefix, missing: missingHere });
  }
}

if (missing.length > 0) {
  console.error(
    `[check-error-registry-parity] FAIL — ${missing.length} keyPrefix${missing.length === 1 ? '' : 'es'} missing keys in en.json error_registry:`
  );
  for (const { prefix, missing: keys } of missing) {
    console.error(`  - ${prefix}: missing ${keys.join(', ')}`);
  }
  console.error(
    `\nFix: add the missing keys to src/i18n/locales/en.json under "error_registry".\n` +
      `Each keyPrefix in ERROR_KEY_MAP needs both <prefix>_message and <prefix>_suggestion.`
  );
  process.exit(1);
}

console.log(
  `[check-error-registry-parity] OK — all ${prefixes.length} keyPrefix${prefixes.length === 1 ? '' : 'es'} have message + suggestion keys in en.json.`
);
