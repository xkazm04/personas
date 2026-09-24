#!/usr/bin/env node
/**
 * typo-allowlist: keeps the census rule `phantom-typo-token` honest.
 *
 * That rule is an ALLOW-LIST written as a static regex: it counts every
 * `typo-*` class name that is NOT one of the names a stylesheet defines. The
 * census engine only takes a static pattern, so the list of defined names is
 * spelled inside the pattern. A new phantom needs no maintenance (it rises the
 * count), and a new token added to CSS but not to the list also rises the
 * count, loudly. The one drift a static list could hide is the other one: a
 * token DELETED from the stylesheets while the pattern still allows it, so its
 * surviving call sites stop being counted. This module is the check for that.
 *
 * It compares two sets and fails when they differ in either direction:
 *   defined  every `.typo-<name>` class selector in src/**\/*.css (comments stripped,
 *            *.proposed.css skipped: see PROPOSAL_SUFFIX)
 *   allowed  the names inside the rule pattern's `typo-(?!(?:a|b|...)` lookahead
 *
 * Runs inside `npm run check` through scripts/census/check-corpus-integrity.mjs,
 * and is asserted on fixtures by scripts/census/self-test.mjs. Also used by
 * eslint-rules/no-raw-text-classes.cjs and scripts/style/lint-edited.mjs to
 * read the real token set at load time.
 *
 *   node scripts/style/typo-allowlist.mjs          # exit 0 agree, 1 disagree, 2 cannot run
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RULE_ID = 'phantom-typo-token';
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'target', 'coverage']);
// A `*.proposed.css` stylesheet is a style-unification PROPOSAL, scoped under
// [data-style-proposal] for the Gate 0 specimen. It defines no app token until
// it is promoted into typography.css, and promotion is the moment this check
// should demand the allow-list change (2026-09-24: typography.proposed.css
// proposes typo-eyebrow; counting it would call real phantoms real).
export const PROPOSAL_SUFFIX = '.proposed.css';

function walkCss(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkCss(full, out);
    } else if (e.name.endsWith('.css') && !e.name.endsWith(PROPOSAL_SUFFIX)) {
      out.push(full);
    }
  }
  return out;
}

/** `.typo-<name>` class selectors in one stylesheet's text, comments removed. */
export function typoNamesInCss(cssText) {
  const code = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const names = new Set();
  for (const m of code.matchAll(/\.typo-([a-z0-9]+(?:-[a-z0-9]+)*)(?![\w-])/g)) names.add(m[1]);
  return names;
}

/** Every typo-* name defined by a stylesheet under `<root>/src`. */
export function definedTypoNames(root = REPO_ROOT) {
  const files = walkCss(join(root, 'src'));
  const names = new Set();
  for (const f of files) for (const n of typoNamesInCss(readFileSync(f, 'utf8'))) names.add(n);
  return { names, files: files.length };
}

/** The allowed names spelled inside the rule pattern, or null if the pattern has no allow-list. */
export function allowListFromPattern(pattern) {
  const m = /typo-\(\?!\(\?:([a-z0-9|-]+)\)/.exec(pattern ?? '');
  return m ? new Set(m[1].split('|')) : null;
}

/** Compare the stylesheets with the rule in `<root>/scripts/census/rules.json`. */
export function compareAllowList(root = REPO_ROOT) {
  const registry = JSON.parse(readFileSync(join(root, 'scripts/census/rules.json'), 'utf8'));
  const rule = (registry.rules ?? []).find((r) => r.id === RULE_ID);
  const allowed = rule ? allowListFromPattern(rule.signal?.pattern) : null;
  const { names: defined, files } = definedTypoNames(root);
  const problems = [];
  if (!rule) problems.push(`census rule "${RULE_ID}" is not in scripts/census/rules.json`);
  else if (!allowed) problems.push(`census rule "${RULE_ID}" has no parseable typo-(?!(?:...)) allow-list in its pattern`);
  if (files === 0 || defined.size === 0) {
    problems.push(`read ${files} stylesheet(s) under src/ and found ${defined.size} typo-* names: the reader is broken, not the tokens gone`);
  }
  const missingFromRule = allowed ? [...defined].filter((n) => !allowed.has(n)).sort() : [];
  const staleInRule = allowed ? [...allowed].filter((n) => !defined.has(n)).sort() : [];
  for (const n of missingFromRule) {
    problems.push(`typo-${n} is defined in CSS but absent from the ${RULE_ID} allow-list, so its real uses count as phantoms; add it to the pattern`);
  }
  for (const n of staleInRule) {
    problems.push(`typo-${n} is allowed by ${RULE_ID} but no stylesheet defines it any more, so its call sites are phantoms nobody counts; remove it from the pattern and re-baseline that rule`);
  }
  return { ok: problems.length === 0, problems, defined, allowed, cssFiles: files };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let result;
  try {
    result = compareAllowList();
  } catch (err) {
    console.error(`typo-allowlist: cannot run (${err?.message ?? err})`);
    process.exit(2);
  }
  if (result.cssFiles === 0 || result.defined.size === 0) {
    console.error(`typo-allowlist: ${result.problems.join('; ')}`);
    process.exit(2);
  }
  if (!result.ok) {
    for (const p of result.problems) console.error(`typo-allowlist: ${p}`);
    process.exit(1);
  }
  console.log(`typo-allowlist OK: ${result.defined.size} typo-* names defined across ${result.cssFiles} stylesheet(s), identical to the ${RULE_ID} allow-list`);
}
