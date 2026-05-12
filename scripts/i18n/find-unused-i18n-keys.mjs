#!/usr/bin/env node
/**
 * Dead-key scanner for src/i18n/locales/en.json.
 *
 * Companion to check-coverage.mjs, which catches stale keys in *non-English*
 * locales (translation drift). This script catches the opposite axis: keys in
 * en.json that no source file references anymore — typically left behind by
 * a rename or a feature removal that updated callers but not the catalog.
 *
 * ## Approach (prefix-match)
 *
 * 1. Flatten en.json to a Set of dotted paths.
 * 2. Walk src/**\/*.{ts,tsx} (excluding i18n/, tests, generated/) and:
 *    a. Collect every `t.<dotted.path>` reference (regex). Any reference
 *       counts as a USED PREFIX — so `t.common` marks the whole `common.*`
 *       subtree as used, which is the right thing for destructuring and
 *       dynamic bracket access (`t.status_tokens[category]`).
 *    b. Collect `tokenLabel(t, '<category>', …)` calls and mark
 *       `status_tokens.<category>` as a used prefix.
 *    c. Read ERROR_KEY_MAP from useTranslatedError.ts and mark
 *       `error_registry.<keyPrefix>_message` + `<keyPrefix>_suggestion` used.
 * 3. A key in en.json is USED if itself or any ancestor prefix is referenced.
 * 4. Everything else is reported as unused.
 *
 * Prefix-match is intentionally permissive — false negatives (claiming a key
 * is used when it isn't) are recoverable; false positives (claiming a live
 * key is dead) would be destructive. Start permissive, tighten if needed.
 *
 * ## Modes
 *
 *   default        warn-only; logs counts and a sample, exit 0.
 *   --strict       exit 1 if any unused keys (use once the backlog is
 *                  drained, then wire into CI).
 *   --json         machine-readable output.
 *   --full         print every unused key (default samples first 50).
 *   --ignore-prefix common.,status_tokens.
 *                  comma-separated prefixes to treat as live regardless
 *                  (use for known dynamic-lookup subtrees that the static
 *                  scanner can't see through).
 *
 * Exit codes:
 *   0  default mode, OR strict mode with zero unused keys.
 *   1  strict mode with unused keys, OR config error.
 *
 * Wire into CI via `npm run check:i18n-dead`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const ROOT = resolve(process.cwd());
const LOCALES_DIR = resolve(ROOT, 'src/i18n/locales');
const SRC_DIR = resolve(ROOT, 'src');
const USE_TRANSLATED_ERROR = resolve(ROOT, 'src/i18n/useTranslatedError.ts');

const asJson = process.argv.includes('--json');
const strictMode = process.argv.includes('--strict');
const fullList = process.argv.includes('--full');
const ignoreArg = process.argv.find((a) => a.startsWith('--ignore-prefix='));
const ignorePrefixes = ignoreArg
  ? ignoreArg.slice('--ignore-prefix='.length).split(',').map((s) => s.trim()).filter(Boolean)
  : [];

// ---------------------------------------------------------------------------
// Step 1 — flatten en.json
// ---------------------------------------------------------------------------

function flattenKeys(obj, prefix = '') {
  const out = new Set();
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
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

const en = JSON.parse(readFileSync(resolve(LOCALES_DIR, 'en.json'), 'utf8'));
const enKeys = flattenKeys(en);
const topLevelSections = new Set(Object.keys(en));

// ---------------------------------------------------------------------------
// Step 2 — collect source files
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'i18n',          // the i18n machinery itself references catalogs by name,
                    // not by t.section.key, so excluding avoids self-reference noise
  '__tests__',
  '__mocks__',
  'node_modules',
]);
const SKIP_FILE_RE = /\.(test|spec|stories)\.(ts|tsx)$/;
// Generated files under src/i18n/generated/* would already be skipped by the
// i18n exclusion above; left as a belt-and-braces guard if generated/ ever
// moves out from under src/i18n/.
const SKIP_PATH_RE = /[\\/]generated[\\/]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(full, out);
    } else if (st.isFile()) {
      if (!/\.(ts|tsx)$/.test(name)) continue;
      if (SKIP_FILE_RE.test(name)) continue;
      if (SKIP_PATH_RE.test(full)) continue;
      out.push(full);
    }
  }
  return out;
}

// Allow useReleasesTranslation.ts even though it lives under features/.../i18n/
// — it's the one sanctioned shape-adapter and contains live `t.releases.whats_new.*`
// references. The skip above only fires on bare directory name 'i18n'; since
// useReleasesTranslation.ts is at src/features/home/components/releases/i18n/,
// it WOULD be skipped. Re-include it explicitly.
function collectExtraFiles() {
  const extras = [
    resolve(ROOT, 'src/features/home/components/releases/i18n/useReleasesTranslation.ts'),
    // Also the i18n shape adapters that reference live keys:
    resolve(ROOT, 'src/i18n/useSidebarTranslation.ts'),
    // useTranslatedError + tokenMaps are parsed separately for their
    // dynamic-key patterns (see steps 3/4) but also include direct refs.
    USE_TRANSLATED_ERROR,
    resolve(ROOT, 'src/i18n/tokenMaps.ts'),
  ];
  return extras.filter((p) => {
    try { return statSync(p).isFile(); } catch { return false; }
  });
}

const files = [...walk(SRC_DIR), ...collectExtraFiles()];

// ---------------------------------------------------------------------------
// Step 3 — scan for references
// ---------------------------------------------------------------------------

// Captures `t.foo.bar.baz` and `tx(t.foo.bar.baz, …)`. The leading `\b` plus
// the requirement that the segment after `t.` starts with a lowercase letter
// or underscore filters out unrelated `t.` patterns (Three.js `t.material`,
// timer locals, etc.) — en.json section names all match [a-z_].
const T_REF_RE = /\bt\.([a-z_][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)*)/g;

// Captures `tokenLabel(t, 'execution', …)` — first arg fixed as `t`, second a
// quoted category name. The category becomes a used prefix under status_tokens.
const TOKEN_LABEL_RE = /\btokenLabel\s*\(\s*t\s*,\s*['"]([a-z_][a-zA-Z0-9_]*)['"]/g;

const usedPrefixes = new Set();

for (const file of files) {
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { continue; }

  let m;
  while ((m = T_REF_RE.exec(src)) !== null) {
    const path = m[1];
    // Filter out non-section roots (heuristic — only sections actually in
    // en.json count). Without this, `t.length`, `t.value`, etc. on unrelated
    // `t` locals get added to the used set with no harm but bloat reports.
    const root = path.split('.')[0];
    if (!topLevelSections.has(root)) continue;
    usedPrefixes.add(path);
  }

  while ((m = TOKEN_LABEL_RE.exec(src)) !== null) {
    usedPrefixes.add(`status_tokens.${m[1]}`);
  }
}

// ---------------------------------------------------------------------------
// Step 4 — extract ERROR_KEY_MAP from useTranslatedError.ts
// ---------------------------------------------------------------------------

// Pulled from the static source, not require()'d, to avoid TypeScript at
// runtime. Pattern: `keyPrefix: 'foo_bar'`.
let errorPrefixes = [];
try {
  const errSrc = readFileSync(USE_TRANSLATED_ERROR, 'utf8');
  const KEY_PREFIX_RE = /keyPrefix:\s*['"]([a-z_][a-zA-Z0-9_]*)['"]/g;
  let m;
  while ((m = KEY_PREFIX_RE.exec(errSrc)) !== null) errorPrefixes.push(m[1]);
} catch {
  // useTranslatedError.ts missing — fall through; error_registry keys
  // (excluding ones referenced via direct t.error_registry.x lookups) will
  // show up as unused, which is itself a signal.
}
for (const p of errorPrefixes) {
  usedPrefixes.add(`error_registry.${p}_message`);
  usedPrefixes.add(`error_registry.${p}_suggestion`);
}
// Generic fallback — referenced via dynamic `getRegistryString(registry, 'generic_message')`
usedPrefixes.add('error_registry.generic_message');
usedPrefixes.add('error_registry.generic_suggestion');
// Severity tokens — friendlySeverityTranslated builds `severity_<x>` dynamically.
// Any `error_registry.severity_*` key is therefore considered live.
usedPrefixes.add('error_registry.severity_');

// ---------------------------------------------------------------------------
// Step 5 — classify each en key
// ---------------------------------------------------------------------------

function isUsed(key) {
  // Ignore-prefix overrides (user-supplied via CLI flag).
  for (const p of ignorePrefixes) {
    if (key === p || key.startsWith(p)) return true;
  }
  // Any ancestor prefix referenced → used.
  for (const used of usedPrefixes) {
    if (key === used) return true;
    if (key.startsWith(`${used}.`)) return true;
    // The reference itself may be DEEPER than the key (e.g. ref `t.a.b.c`
    // does not mean `t.a.b.something_else` is used — only `t.a.b.c` and
    // descendants). So the reverse (used.startsWith(key + '.')) is NOT a
    // match; intermediate keys are non-leaf and won't appear in enKeys anyway.
    if (used.startsWith(`${key}.`)) return true; // intermediate node has descendant ref
  }
  // Special: `error_registry.severity_*` umbrella above.
  if (key.startsWith('error_registry.severity_')) return true;
  return false;
}

const unused = [];
for (const key of enKeys) {
  if (!isUsed(key)) unused.push(key);
}
unused.sort();

// Group by top-level section for readability.
const bySection = new Map();
for (const k of unused) {
  const section = k.split('.')[0];
  if (!bySection.has(section)) bySection.set(section, []);
  bySection.get(section).push(k);
}

// ---------------------------------------------------------------------------
// Step 6 — emit
// ---------------------------------------------------------------------------

if (asJson) {
  process.stdout.write(JSON.stringify({
    sourceKeyCount: enKeys.size,
    unusedCount: unused.length,
    scannedFiles: files.length,
    sectionsScanned: [...topLevelSections].sort(),
    ignorePrefixes,
    bySection: Object.fromEntries(
      [...bySection.entries()].map(([k, v]) => [k, { count: v.length, keys: v }]),
    ),
    unusedKeys: unused,
  }, null, 2) + '\n');
} else {
  const pct = enKeys.size ? ((unused.length / enKeys.size) * 100).toFixed(1) : '0.0';
  console.log(`i18n dead-key scan — ${enKeys.size} keys in en.json across ${files.length} source files`);
  console.log(`  unused: ${unused.length} (${pct}%)`);
  if (ignorePrefixes.length) {
    console.log(`  ignore-prefix: ${ignorePrefixes.join(', ')}`);
  }
  console.log('');

  if (unused.length) {
    const sections = [...bySection.entries()].sort((a, b) => b[1].length - a[1].length);
    console.log('Section          | Unused | Total');
    console.log('-----------------|--------|------');
    for (const [section, keys] of sections) {
      const total = [...enKeys].filter((k) => k === section || k.startsWith(`${section}.`)).length;
      console.log(`${section.padEnd(16)} | ${String(keys.length).padStart(6)} | ${String(total).padStart(5)}`);
    }
    console.log('');

    if (fullList) {
      console.log('--- All unused keys ---');
      for (const k of unused) console.log(`  - ${k}`);
    } else {
      const sample = unused.slice(0, 50);
      console.log(`--- Sample (first ${sample.length} of ${unused.length}) ---`);
      for (const k of sample) console.log(`  - ${k}`);
      if (unused.length > sample.length) {
        console.log(`  … and ${unused.length - sample.length} more (run with --full to list all)`);
      }
    }
    console.log('');
  } else {
    console.log('No unused keys detected.');
  }
}

if (strictMode && unused.length) {
  console.error(`\nFAIL (--strict): ${unused.length} unused keys in en.json. Remove them, or add the prefix to --ignore-prefix if dynamically referenced.`);
  process.exit(1);
}

if (!asJson && unused.length) {
  console.warn(
    '\nWARN: dead keys detected (default mode, exit 0). Static scan — false positives possible for dynamic-key lookups; pass --ignore-prefix=<prefix> for known dynamic subtrees. Re-run with --strict once the backlog is drained to gate.',
  );
}
