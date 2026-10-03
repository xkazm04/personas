#!/usr/bin/env node
/**
 * Collapse the `text-foreground/NN` family onto the one muting ladder.
 *
 * WHY THIS EXISTS, measured 2026-10-03 on a clean `git archive HEAD` export:
 * the app has ONE muting level and three names for it (`--muted-foreground`,
 * `.typo-caption`, the kit's `--quiet`, all now 80% of the theme's own
 * `--foreground`) — and beside it an uncontrolled fourth family of 1,797
 * call sites across 719 files picking their own fraction, at 17 distinct
 * levels on `text-foreground` (/15 to /95) plus 7 on `text-muted-foreground`.
 * `check:themes` cannot see any of them: they live in `.tsx` class strings,
 * and no CSS reader can reach a class string. The census rule
 * `off-ladder-ink-opacity` stops the family GROWING; this codemod is how it
 * shrinks.
 *
 * THE MAPPING, and why each row is what it is (contrast figures are the worst
 * theme of eleven, computed by scripts/check-themes.mjs' own maths):
 *
 *   /85 /90 /95        -> `text-foreground`            845 matches
 *     Within 1.18:1 of full ink. /90 on the default theme is 12.7:1 against
 *     full ink's 15.7:1 — a difference no reader can name, carried by 574
 *     sites. These are full ink written three ways.
 *
 *   /50 … /80          -> `text-muted-foreground`      434 matches
 *     The muting band. The token IS 80% now, so /80 is exactly the token and
 *     the rest are approximations of it. /50 is the AA floor on the dark
 *     themes (4.5:1) and fails on the light ones (3.3:1), so nothing in this
 *     band is reliably legible except via the token.
 *
 *   /15 … /45          -> REPORTED, NOT CHANGED         138 matches
 *     Sub-AA in every theme (4.1:1 at /45 on dark, 2.9:1 on light). Two
 *     different things wear this spelling and a regex cannot tell them apart:
 *     secondary prose that should be the muting level, and an ICON STROKE,
 *     separator or decorative glyph, which is not an ink token's job at all
 *     (measured: 2 of a 12-site precision sample were icons). Hand review.
 *
 *   placeholder:*      -> `--placeholders` pass only    107 matches
 *     A placeholder is not content, so WCAG AA does not bind it, and the
 *     repo's own idiom is `placeholder-muted-foreground/30`
 *     (src/lib/utils/designTokens.ts:142). Moving 82 sub-/50 placeholders onto
 *     the muting level is a visible design change, not a token cleanup, so it
 *     is opt-in and separate.
 *
 * Variant prefixes (`hover:`, `group-hover:`, `focus-visible:`, …) are kept
 * and mapped by the same table: a state's job is to CHANGE, and the pair still
 * changes when both ends are on the ladder.
 *
 * STAGED, NOT RUN (2026-10-03). The sweep touches 719 files across every
 * feature module and three other builders were live in `src/features/**` when
 * it was written. `--write` exists and works; running it is a scheduling
 * decision, and it wants a quiet tree and its own commit.
 *
 * Usage:
 *   node scripts/style/codemod-ink-ladder.mjs                 # report (default)
 *   node scripts/style/codemod-ink-ladder.mjs --write          # apply rows 1-2
 *   node scripts/style/codemod-ink-ladder.mjs --write --placeholders
 *   node scripts/style/codemod-ink-ladder.mjs --path src/features/home
 *   node scripts/style/codemod-ink-ladder.mjs --json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const WRITE = flag('write');
const PLACEHOLDERS = flag('placeholders');
const JSON_OUT = flag('json');
const SCOPE = opt('path', 'src');

/** The rung an ink fraction belongs on, or null when a human must look. */
function rung(level) {
  if (level >= 85) return 'text-foreground';
  if (level >= 50) return 'text-muted-foreground';
  return null;
}

// One class token: an optional chain of variant prefixes, then the ink token
// with its fraction. Mirrors the census rule `off-ladder-ink-opacity`, plus
// the capture groups it does not need.
const RE = /(?<![\w-])((?:[a-z][a-z0-9-]*:)*)(text|placeholder)-(muted-)?foreground\/(\d{1,3})(?![\w.-])/g;

const files = execSync(`git ls-files ${SCOPE}`, { cwd: REPO, encoding: 'utf8' })
  .trim().split('\n').filter((f) => /\.(ts|tsx)$/.test(f) && !/(__tests__|\.test\.tsx?$)/.test(f));

const changed = [];
const review = [];
const tally = new Map();
let rewrites = 0;

for (const rel of files) {
  const abs = resolve(REPO, rel);
  let src;
  try { src = readFileSync(abs, 'utf8'); } catch { continue; }
  if (!/[\s"'`]?(?:text|placeholder)-(?:muted-)?foreground\//.test(src)) continue;
  let touched = 0;
  const next = src.replace(RE, (whole, variants, kind, muted, lvlRaw, offset) => {
    const level = Number(lvlRaw);
    const isPlaceholder = kind === 'placeholder' || /(^|:)placeholder:/.test(variants);
    const key = `${muted ? 'muted-foreground' : 'foreground'}/${level}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    const line = src.slice(0, offset).split('\n').length;
    if (isPlaceholder) {
      if (!PLACEHOLDERS) { review.push({ rel, line, whole, why: 'placeholder (opt in with --placeholders)' }); return whole; }
      touched++; rewrites++;
      return `${variants}${kind === 'placeholder' ? 'placeholder-' : 'text-'}muted-foreground`;
    }
    const to = rung(level);
    if (!to) { review.push({ rel, line, whole, why: `below /50 — sub-AA in every theme; prose or glyph?` }); return whole; }
    touched++; rewrites++;
    return `${variants}${to}`;
  });
  if (touched > 0) {
    changed.push({ rel, rewrites: touched });
    if (WRITE) writeFileSync(abs, next, 'utf8');
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    mode: WRITE ? 'write' : 'report', placeholders: PLACEHOLDERS, scope: SCOPE,
    filesVisited: files.length, filesChanged: changed.length, rewrites,
    handReview: review.length, levels: Object.fromEntries([...tally].sort()),
    changed, review,
  }, null, 2));
  process.exit(0);
}

console.log(`\nink ladder codemod — ${WRITE ? 'WRITE' : 'report (no files touched)'}  scope ${SCOPE}`);
console.log(`  visited ${files.length} file(s)`);
console.log(`  ${WRITE ? 'rewrote' : 'would rewrite'} ${rewrites} site(s) in ${changed.length} file(s)`);
console.log(`  hand review: ${review.length} site(s)\n`);
const levels = [...tally].sort((a, b) => a[0].localeCompare(b[0]) || 0);
for (const [k, n] of levels) {
  const lvl = Number(k.split('/')[1]);
  const to = rung(lvl) ?? 'HAND REVIEW';
  console.log(`  ${k.padEnd(22)} ${String(n).padStart(5)}  -> ${to}`);
}
if (review.length > 0) {
  console.log('\n  hand review (first 25):');
  for (const r of review.slice(0, 25)) console.log(`    ${r.rel}:${r.line}  ${r.whole}  — ${r.why}`);
  if (review.length > 25) console.log(`    … and ${review.length - 25} more (use --json for all)`);
}
console.log(
  WRITE
    ? '\n  Run `npm run census -- --rule off-ladder-ink-opacity` and re-baseline the DROP\n'
      + '  with `npm run census -- --update` in the same commit. Never --update a rise.\n'
    : '\n  Nothing was written. Add --write to apply.\n',
);
