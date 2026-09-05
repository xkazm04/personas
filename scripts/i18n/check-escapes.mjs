#!/usr/bin/env node
/**
 * i18n escape-integrity check.
 *
 * WHY THIS EXISTS. On 2026-09-05 a sweep found 176 values across 12 of the 14
 * locales carrying runs of LITERAL backslashes where a character was meant —
 * German users read the persona search box as `Personas suchen\\\\\\\\u2026`
 * instead of `Personas suchen…`. The corruption was an escaping cascade: some
 * earlier tooling pass re-escaped already-escaped values, doubling the
 * backslash run each time, so `…` became `\\u2026`, `\\\\u2026`, and so on
 * until the escape stopped being an escape and became text.
 *
 * Nothing caught it, and two gates were actively fooled by it:
 *   - check-coverage sees a present, non-empty string and is satisfied;
 *   - check-untranslated compares against English and PASSED these values
 *     precisely BECAUSE they were corrupted — the mangling made an untranslated
 *     English string differ from en.json byte-for-byte. Repairing the 176 values
 *     un-masked 27 genuinely untranslated strings that had been hiding behind
 *     the damage for as long as it existed.
 *
 * This check cannot live in the census: that runner treats a rule matching zero
 * files as a broken rule and exits 1 (run-census.mjs:28), so it cannot hold a
 * ratchet whose correct value is zero. This one can.
 *
 * WHAT IT LOOKS AT. Values in the parsed catalogs, not raw file text — a raw
 * scan would have to tell a legitimate JSON `\"` or `\n` escape apart from the
 * corruption, and after parsing there is nothing to tell apart: a correct value
 * simply contains the character.
 *
 * Usage: node scripts/i18n/check-escapes.mjs [--self-test] [--json]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCALE_DIR = join(ROOT, 'src', 'i18n', 'locales');

const BS = String.fromCharCode(92);

/**
 * A parsed value is damaged when it contains either:
 *   - a run of two or more literal backslashes, or
 *   - a single literal backslash immediately followed by a uXXXX codepoint.
 *
 * Built by concatenation rather than written as a regex literal on purpose: a
 * backslash-dense literal is exactly the thing that gets mangled on its way
 * through a shell, a heredoc or a JSON round-trip, which is the class of bug
 * this file exists to catch.
 */
const ESC = BS + BS; // matches ONE literal backslash
const DAMAGED = new RegExp(ESC + '{2,}|' + ESC + 'u[0-9a-fA-F]{4}');

function walk(node, path, out) {
  if (typeof node === 'string') {
    if (DAMAGED.test(node)) out.push({ path, value: node });
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${path}[${i}]`, out));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, out);
  }
}

/** Prove the matcher can still see the shape it was written for. */
function selfTest() {
  const bad = 'Personas suchen' + BS.repeat(16) + 'u2026';
  const badPair = 'x' + BS.repeat(4) + 'y';
  const good = 'Personas suchen…';
  const goodQuote = 'say "hi"';
  const goodNewline = 'a\nb';
  const cases = [
    ['16 backslashes + u2026', DAMAGED.test(bad), true],
    ['a bare run of 2 backslashes', DAMAGED.test(badPair), true],
    ['a real ellipsis', DAMAGED.test(good), false],
    ['a plain quote', DAMAGED.test(goodQuote), false],
    ['a real newline', DAMAGED.test(goodNewline), false],
  ];
  let ok = true;
  for (const [name, got, want] of cases) {
    if (got !== want) {
      console.error(`  self-test FAILED: ${name} — matched=${got}, expected=${want}`);
      ok = false;
    }
  }
  return ok;
}

const args = process.argv.slice(2);

if (!selfTest()) {
  console.error('\ni18n escape check: the matcher no longer detects its own fixtures. Fix it before trusting a green run.');
  process.exit(1);
}
if (args.includes('--self-test')) {
  console.log('i18n escape check: self-test passed (5 fixtures).');
  process.exit(0);
}

const files = readdirSync(LOCALE_DIR).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.error(`i18n escape check: no locale files under ${LOCALE_DIR} — looked at nothing, which is not the same as finding nothing.`);
  process.exit(1);
}

const findings = [];
let valuesScanned = 0;
for (const file of files) {
  const lang = file.replace(/\.json$/, '');
  const data = JSON.parse(readFileSync(join(LOCALE_DIR, file), 'utf8'));
  const before = findings.length;
  const out = [];
  walk(data, '', out);
  for (const hit of out) findings.push({ lang, ...hit });
  valuesScanned += countStrings(data);
  void before;
}

function countStrings(node) {
  if (typeof node === 'string') return 1;
  if (Array.isArray(node)) return node.reduce((n, v) => n + countStrings(v), 0);
  if (node && typeof node === 'object') return Object.values(node).reduce((n, v) => n + countStrings(v), 0);
  return 0;
}

if (args.includes('--json')) {
  console.log(JSON.stringify({ files: files.length, valuesScanned, findings }, null, 2));
  process.exit(findings.length === 0 ? 0 : 1);
}

console.log(`i18n escape check — ${files.length} locales, ${valuesScanned} values scanned\n`);

if (findings.length === 0) {
  console.log('No literal backslash runs. Every escape resolved to the character it names.');
  process.exit(0);
}

const byLang = new Map();
for (const f of findings) byLang.set(f.lang, (byLang.get(f.lang) ?? 0) + 1);
console.error(`${findings.length} value(s) carry literal backslash runs instead of the character the escape names:\n`);
for (const [lang, n] of [...byLang].sort((a, b) => b[1] - a[1])) {
  console.error(`  ${lang} (${n}):`);
  for (const f of findings.filter((x) => x.lang === lang).slice(0, 5)) {
    console.error(`    ${f.path} = ${JSON.stringify(f.value.slice(0, 70))}`);
  }
}
console.error(`
This is an escaping cascade, not a translation problem: the value was correct
once and a tool re-escaped an already-escaped string. Repair it by collapsing
the backslash run to the character it names (\\u2026 -> …, \\" -> ", \\<LF> -> a
newline), using en.json as the reference for what the value should read.

Repairing may un-mask untranslated strings: a mangled English value differs
from en.json byte-for-byte, so check-untranslated cannot see it until the
damage is gone.`);
process.exit(1);
