#!/usr/bin/env node
/**
 * typo-allowlist: no typo-* class name may exist that no stylesheet defines.
 *
 * A "phantom" type token (typo-body-sm, typo-overline, typo-h3, ...) renders as
 * inherited type while reading as tokenised, so the gap is invisible in review.
 * The style-unification foundation (5e5cd9ca5, 2026-09-24) mapped every phantom
 * in the tree, so the condition is EXTINCT and this check holds it at zero.
 *
 * Why this is not a census rule any more: from 2026-09-24 to 2026-09-24 it was
 * one (`phantom-typo-token`, a static regex with the defined names spelled in a
 * negative lookahead). The census treats a rule that matches zero files as a
 * broken matcher, which is right for a ratchet and wrong for an extinct
 * condition. An allow-list derived at RUN TIME from the stylesheets is also the
 * stronger form (design-tokens / token-enforcement: "an allow-list against the
 * authority"), because there is no copied list that can drift from the CSS.
 *
 * It fails loud on "looked at nothing": fewer source files walked, or fewer
 * typo-* uses seen, than the floors below means the walker broke, not that the
 * tree went clean.
 *
 *   defined   every `.typo-<name>` class selector in src/**\/*.css (comments stripped,
 *             *.proposed.css skipped: see PROPOSAL_SUFFIX)
 *   scanned   every typo-* class-shaped name in src/**\/*.{ts,tsx}, test files and
 *             EXCLUDED_FILES skipped, comment-only lines skipped
 *
 * Runs inside `npm run check` through scripts/census/check-corpus-integrity.mjs
 * and is asserted on fixtures by scripts/census/self-test.mjs.
 * eslint-rules/no-raw-text-classes.cjs derives the same defined set the same way
 * (it cannot import this ESM module) and is what the edit-time hook reports.
 *
 *   node scripts/style/typo-allowlist.mjs     # exit 0 clean, 1 phantom found, 2 cannot run
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'target', 'coverage', '__tests__']);
// A `*.proposed.css` stylesheet is a style-unification PROPOSAL, scoped under
// [data-style-proposal] for the Gate 0 specimen. It defines no app token until
// it is promoted into typography.css (typo-eyebrow was, at Gate 0).
export const PROPOSAL_SUFFIX = '.proposed.css';
/** Files whose `typo-` strings are not class names. Each carries its reason. */
export const EXCLUDED_FILES = new Map([
  ['src/lib/harness/scenario-parser.ts', 'typo-mapping, typo-home, ... are harness scenario ids that share the prefix'],
]);
/** Liveness floors for the real tree (measured 2026-09-24: ~2,700 files walked, ~10,600 uses). */
export const FLOORS = { files: 1500, uses: 5000 };

function walk(dir, keep, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full, keep, out);
    } else if (keep(e.name)) {
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
  const files = walk(join(root, 'src'), (n) => n.endsWith('.css') && !n.endsWith(PROPOSAL_SUFFIX));
  const names = new Set();
  for (const f of files) for (const n of typoNamesInCss(readFileSync(f, 'utf8'))) names.add(n);
  return { names, files: files.length };
}

const isSource = (n) => /\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n) && !n.endsWith('.d.ts');
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;
const TYPO_NAME = /(?<![\w-])typo-([a-z0-9]+(?:-[a-z0-9]+)*)(?![\w-])/g;

/**
 * Scan `<root>/src` for typo-* names no stylesheet defines.
 * @param {string} root
 * @param {{files:number, uses:number}} floors liveness floors ("looked at nothing" is a failure)
 */
export function findPhantoms(root = REPO_ROOT, floors = FLOORS) {
  const { names: defined, files: cssFiles } = definedTypoNames(root);
  const problems = [];
  if (cssFiles === 0 || defined.size === 0) {
    problems.push(`read ${cssFiles} stylesheet(s) under src/ and found ${defined.size} typo-* names: the reader is broken, not the tokens gone`);
    return { ok: false, broken: true, problems, sites: [], walked: 0, uses: 0, defined, cssFiles };
  }
  const sources = walk(join(root, 'src'), isSource);
  const sites = [];
  let uses = 0;
  for (const f of sources) {
    const rel = relative(root, f).split('\\').join('/');
    if (EXCLUDED_FILES.has(rel)) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (COMMENT_LINE.test(line)) return;
      for (const m of line.matchAll(TYPO_NAME)) {
        uses++;
        if (!defined.has(m[1])) sites.push(`${rel}:${i + 1} typo-${m[1]}`);
      }
    });
  }
  let broken = false;
  if (sources.length < floors.files || uses < floors.uses) {
    broken = true;
    problems.push(`walked ${sources.length} source file(s) and saw ${uses} typo-* use(s), under the floors (${floors.files} / ${floors.uses}): the walker is broken, not the tree clean`);
  }
  for (const s of sites) {
    problems.push(`${s} is defined by no stylesheet, so it renders as inherited type; use a token from src/styles/typography.css (.claude/Design.md section 2)`);
  }
  return { ok: problems.length === 0, broken, problems, sites, walked: sources.length, uses, defined, cssFiles };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let result;
  try {
    result = findPhantoms();
  } catch (err) {
    console.error(`typo-allowlist: cannot run (${err?.message ?? err})`);
    process.exit(2);
  }
  if (result.broken) {
    for (const p of result.problems) console.error(`typo-allowlist: ${p}`);
    process.exit(2);
  }
  if (!result.ok) {
    for (const p of result.problems) console.error(`typo-allowlist: ${p}`);
    process.exit(1);
  }
  console.log(`typo-allowlist OK: 0 phantom typo-* names; ${result.uses} uses in ${result.walked} source files, all among the ${result.defined.size} names ${result.cssFiles} stylesheet(s) define`);
}
