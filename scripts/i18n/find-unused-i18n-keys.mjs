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
 * 3. A key in en.json is REFERENCED if itself or any ancestor prefix is
 *    referenced.
 * 4. A section named in routeSections.ts is preload-declared, which exempts its
 *    unreferenced keys from the dead report (step 3b) — but the exemption is now
 *    counted and attributed rather than being invisible (see below).
 * 5. Everything else is reported as unused.
 *
 * Prefix-match is intentionally permissive — false negatives (claiming a key
 * is used when it isn't) are recoverable; false positives (claiming a live
 * key is dead) would be destructive. Start permissive, tighten if needed.
 *
 * ## Preload-only sections — the retired-feature hole
 *
 * Step 3b used to fold section names straight into the used-prefix set, so a
 * single quoted token in routeSections.ts marked the WHOLE section live and the
 * exemption left no trace in the report. A retired feature whose section name
 * survived as a preload hint therefore shed no keys: `foundry` sat at 40 keys
 * with 3 call sites and this scanner reported zero dead keys for it, in all 14
 * locales, for months (dd338ea25 removed 38 of them by hand).
 *
 * Removing the exemption outright is not the fix — measured 2026-08-29 it turns
 * 118 reported dead keys into 1,786 across 20 sections that are plainly live
 * (overview 618, vault 246, debt 199), i.e. exactly the destructive
 * false-positive direction the permissive design exists to avoid.
 *
 * So the exemption stays, and the blindness is replaced by a signal that CAN
 * go red: a preload-declared section in which **zero** keys carry any per-key
 * reference is a retired feature's catalog surviving as a route hint. That is
 * the same condition `check-route-sections.mjs` records in its
 * UNREFERENCED_SECTIONS registry for undeclared sections — declaring the
 * section in routeSections.ts must not buy an exemption from it. It fails the
 * run (both modes). Fix by deleting the section's keys and its routeSections.ts
 * entry, by giving it a real call site, or — for a genuinely dynamic subtree —
 * by passing `--ignore-prefix=<section>.`.
 *
 * ## Modes
 *
 *   default        warn-only for unused keys; logs counts and a sample.
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
 *   0  default mode with no preload-only section, OR strict mode with zero
 *      unused keys and no preload-only section.
 *   1  a preload-only section (either mode), strict mode with unused keys,
 *      OR config error.
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
// useReleasesTranslation.ts is at src/features/home/sub_releases/i18n/,
// it WOULD be skipped. Re-include it explicitly.
function collectExtraFiles() {
  const extras = [
    resolve(ROOT, 'src/features/home/sub_releases/i18n/useReleasesTranslation.ts'),
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

// `t` is not the only binding that carries the translation tree:
//
//   import { en } from '@/i18n/en'      → `en.alerts.x`   (54 modules bind English
//                                         at module scope: alertSlice, deployTarget,
//                                         executionSlice, modelCatalog, …)
//   const notif = getActiveTranslations()  → `notif.execution.x`
//
// Scanning only `t.` reported all of `alerts.*`, `deploy_errors.*` and much of
// `execution.*` as dead while they were live through the shim. Purging on that
// output deletes a live key, and a missing leaf renders "" (interpolate() returns
// empty for a non-string template) — a blank label, strictly worse than an
// untranslated one. Collect every alias, then match `<alias>.<dotted.path>`.
// Bare alias: `const notif = getActiveTranslations()` — NOT followed by a dot
// (a dotted RHS is a sub-object alias, handled separately below).
const ALIAS_DECL_RE = /(?:const|let|var)\s+(\w+)\s*=\s*getActiveTranslations\s*\(\s*\)(?!\s*\.)/g;
const aliasRefRe = (name) =>
  new RegExp(`(?<![\\w.$])${name}\\.([a-z_][a-zA-Z0-9_]*(?:\\.[a-zA-Z0-9_]+)*)`, 'g');

// Chained call, never bound to a variable:
//   getActiveTranslations().auth.login_timed_out   (src/stores/authStore.ts)
// The whole `auth` section was deleted because nothing matched `t.auth`.
const CHAINED_RE = /getActiveTranslations\s*\(\s*\)\.([a-z_][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)*)/g;

// Sub-object alias: a NESTED node bound to a local, then read by leaf name:
//   const t = getActiveTranslations().agents.health_digest
//   …
//   interpolate(t.signal_open_healing_error, …)
// `t.signal_open_healing_error` fails the section-root filter (the root is a
// leaf name, not a section), so ~14 live keys under agents.health_digest looked
// dead. Capture (alias → base path), then resolve `<alias>.<leaf>` to
// `<base>.<leaf>`.
const SUBOBJ_DECL_RE =
  /(?:const|let|var)\s+(\w+)\s*=\s*(?:getActiveTranslations\s*\(\s*\)|\ben\b|\bt\b)\.([a-z_][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)*)/g;

// A SECOND string channel, parallel to `t` and invisible to every pattern
// above: `debtText('key')` and `<DebtText k="key" />` (src/i18n/DebtText.tsx)
// read the `debt` section directly by key. 113 files use it. Because nothing
// here matched it, all 539 `debt` keys were reported dead — 81% of this
// scanner's entire dead report — and both value-level gates
// (check-untranslated.mjs, plan-gaps.mjs) skip scanner-flagged-dead keys, so
// the section never entered a translation work list and sat 0% translated in
// every locale while looking green.
//
// Both call forms are static string literals today (verified 2026-08-09: 85
// debtText() calls, 260 <DebtText> elements, zero dynamic keys), so the key can
// be extracted exactly rather than marking the whole section live.
const DEBT_CALL_RE = /\bdebtText\s*\(\s*['"]([a-zA-Z0-9_]+)['"]/g;
const DEBT_JSX_RE = /<\s*DebtText\b[^>]*?\bk\s*=\s*['"]([a-zA-Z0-9_]+)['"]/g;

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

  while ((m = CHAINED_RE.exec(src)) !== null) {
    if (topLevelSections.has(m[1].split('.')[0])) usedPrefixes.add(m[1]);
  }

  DEBT_CALL_RE.lastIndex = 0;
  while ((m = DEBT_CALL_RE.exec(src)) !== null) usedPrefixes.add(`debt.${m[1]}`);
  DEBT_JSX_RE.lastIndex = 0;
  while ((m = DEBT_JSX_RE.exec(src)) !== null) usedPrefixes.add(`debt.${m[1]}`);

  // Sub-object aliases, resolved to their absolute path.
  const subObj = new Map(); // aliasName -> base dotted path
  while ((m = SUBOBJ_DECL_RE.exec(src)) !== null) {
    const [, alias, base] = m;
    if (topLevelSections.has(base.split('.')[0])) subObj.set(alias, base);
  }
  for (const [alias, base] of subObj) {
    usedPrefixes.add(base); // the node itself is referenced
    const re = aliasRefRe(alias);
    while ((m = re.exec(src)) !== null) usedPrefixes.add(`${base}.${m[1]}`);
  }

  // `en` (the back-compat shim) plus any local alias of getActiveTranslations().
  const aliases = new Set(['en']);
  while ((m = ALIAS_DECL_RE.exec(src)) !== null) aliases.add(m[1]);
  for (const alias of aliases) {
    if (alias === 't') continue; // already covered by T_REF_RE
    const re = aliasRefRe(alias);
    while ((m = re.exec(src)) !== null) {
      const path = m[1];
      // The section-root filter is what makes this safe: `en.get(…)`,
      // `notif.length`, `token.map` all fail it.
      if (!topLevelSections.has(path.split('.')[0])) continue;
      usedPrefixes.add(path);
    }
  }
}

// ---------------------------------------------------------------------------
// Step 3b — routeSections.ts names whole sections as bare string literals
// ---------------------------------------------------------------------------
// `credentials: ['vault', 'connector_roles', 'auth']` — these sections are
// preloaded by route and never written as `t.auth`. The `auth` section (1 key)
// was purged because of this; restoring it cost a full revert.
//
// These names go into their OWN set, not `usedPrefixes`: the exemption still
// suppresses the dead report for the section's keys (removing it produces
// ~1,668 false positives — see the header), but it is now attributable per
// section, and a section where the exemption is doing ALL the work is reported
// as preload-only and fails the run.
const preloadSections = new Set();
try {
  const routeSrc = readFileSync(resolve(ROOT, 'src/i18n/routeSections.ts'), 'utf8');
  for (const m of routeSrc.matchAll(/['"]([a-z_][a-zA-Z0-9_]*)['"]/g)) {
    if (topLevelSections.has(m[1])) preloadSections.add(m[1]);
  }
} catch {
  // routeSections.ts missing — section-preload hints unavailable; sections only
  // referenced there will report as unused, which is a visible signal.
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

function isReferenced(key) {
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

const sectionOf = (key) => key.split('.')[0];

// Keys with no per-key reference of any kind. The preload exemption is applied
// AFTER this, so it stays measurable instead of disappearing into the used set.
const unreferenced = [];
for (const key of enKeys) {
  if (!isReferenced(key)) unreferenced.push(key);
}

const sectionTotals = new Map();
for (const key of enKeys) sectionTotals.set(sectionOf(key), (sectionTotals.get(sectionOf(key)) ?? 0) + 1);
const sectionUnreferenced = new Map();
for (const key of unreferenced) {
  sectionUnreferenced.set(sectionOf(key), (sectionUnreferenced.get(sectionOf(key)) ?? 0) + 1);
}

// A preload-declared section in which NOTHING is referenced per key. Not a
// heuristic per-key guess — the whole catalog has no call site, which is the
// retired-feature shape. `--ignore-prefix=<section>.` opts a genuinely dynamic
// subtree out.
const preloadOnlySections = [...preloadSections]
  .filter((s) => (sectionTotals.get(s) ?? 0) > 0)
  .filter((s) => (sectionUnreferenced.get(s) ?? 0) === sectionTotals.get(s))
  .sort();

// Reported dead: unreferenced AND not covered by a preload declaration.
const unused = unreferenced.filter((k) => !preloadSections.has(sectionOf(k)));
// Suppressed only by the preload declaration — the previously invisible bucket.
const sectionExempt = unreferenced.filter((k) => preloadSections.has(sectionOf(k)));
const exemptBySection = new Map();
for (const key of sectionExempt) {
  exemptBySection.set(sectionOf(key), (exemptBySection.get(sectionOf(key)) ?? 0) + 1);
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
    preloadSections: [...preloadSections].sort(),
    preloadOnlySections,
    sectionExemptCount: sectionExempt.length,
    sectionExemptBySection: Object.fromEntries(
      [...exemptBySection.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => [s, { exempt: n, total: sectionTotals.get(s) ?? 0 }]),
    ),
    bySection: Object.fromEntries(
      [...bySection.entries()].map(([k, v]) => [k, { count: v.length, keys: v }]),
    ),
    unusedKeys: unused,
  }, null, 2) + '\n');
} else {
  const pct = enKeys.size ? ((unused.length / enKeys.size) * 100).toFixed(1) : '0.0';
  console.log(`i18n dead-key scan — ${enKeys.size} keys in en.json across ${files.length} source files`);
  console.log(`  unused: ${unused.length} (${pct}%)`);
  console.log(
    `  exempt via routeSections.ts preload declaration: ${sectionExempt.length} across ${exemptBySection.size} section(s)`,
  );
  if (ignorePrefixes.length) {
    console.log(`  ignore-prefix: ${ignorePrefixes.join(', ')}`);
  }
  console.log('');

  if (exemptBySection.size) {
    const top = [...exemptBySection.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log('Preload-exempt (unreferenced keys the section declaration hides)');
    console.log('Section          | Exempt | Total');
    console.log('-----------------|--------|------');
    for (const [section, n] of top) {
      console.log(`${section.padEnd(16)} | ${String(n).padStart(6)} | ${String(sectionTotals.get(section) ?? 0).padStart(5)}`);
    }
    if (exemptBySection.size > top.length) {
      console.log(`  … and ${exemptBySection.size - top.length} more section(s)`);
    }
    console.log('');
  }

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

// A preload-declared section with zero referenced keys fails in BOTH modes: it
// is a structural assertion, not a per-key heuristic, so the warn-only posture
// that protects against false positives does not apply to it.
if (preloadOnlySections.length) {
  console.error(
    `\nFAIL: ${preloadOnlySections.length} preload-only section(s) — declared in src/i18n/routeSections.ts, but NOT ONE of their keys has a call site anywhere in src/:`,
  );
  for (const s of preloadOnlySections) {
    console.error(`  - ${s} (${sectionTotals.get(s)} key(s), 0 referenced) — dead weight in all 14 locales`);
  }
  console.error(
    'A retired feature left its section name behind as a route preload hint, which exempts the whole catalog from the dead-key scan. Delete the keys and the routeSections.ts entry, give the section a real call site, or pass --ignore-prefix=<section>. if it is genuinely read dynamically.',
  );
  process.exit(1);
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
