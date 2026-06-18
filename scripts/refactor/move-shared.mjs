#!/usr/bin/env node
/**
 * move-shared.mjs — relocate shared components and rewrite their @/ import
 * specifiers across src/. Driven by the catalog-curation manifest (Phase 1).
 *
 * Each arg pair is `<oldRelToSrc> <newRelToSrc>` (paths under src/, WITHOUT
 * extension for single files; a directory is detected and moved wholesale).
 * Folder moves rewrite the whole prefix; file moves match a specifier boundary
 * (quote/slash lookahead) so e.g. `PersonaIcon` never partial-hits `PersonaIconPickerModal`.
 *
 *   node scripts/refactor/move-shared.mjs \
 *     features/shared/components/editors/draft-editor features/templates/draft-editor
 */
import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, sep, resolve, relative } from 'node:path';
import { execSync } from 'node:child_process';

const SRC = 'src';
const argv = process.argv.slice(2);
const pairs = [];
for (let i = 0; i < argv.length; i += 2) pairs.push([argv[i], argv[i + 1]]);
if (!pairs.length || pairs.some((p) => !p[1])) {
  console.error('usage: move-shared.mjs <oldRelToSrc> <newRelToSrc> [<old2> <new2> ...]');
  process.exit(1);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const posix = (p) => p.split(sep).join('/');

// 1) git mv each move at FILE granularity (Windows locks the directory node on a
// dir rename, but individual file renames succeed; retry absorbs transient locks).
function walkFiles(d) {
  const out = [];
  for (const n of readdirSync(d)) {
    const f = join(d, n);
    if (statSync(f).isDirectory()) out.push(...walkFiles(f));
    else out.push(f);
  }
  return out;
}
// Before moving a file, convert its RELATIVE imports to `@/` absolutes resolved
// against its ORIGINAL location. Relatives pointing outside the moved subtree
// would otherwise dangle at the new depth; ones pointing to co-moved siblings
// become absolutes that the prefix-rewrite (step 2) then fixes. Uniform + safe.
function absolutizeRelatives(absFile) {
  const dir = dirname(absFile);
  const orig = readFileSync(absFile, 'utf8');
  const s = orig.replace(/((?:from|import)\s+['"])(\.[^'"]*)(['"])/g, (_m, pre, spec, post) => {
    const rel = relative(SRC, resolve(dir, spec)).split(sep).join('/');
    return `${pre}@/${rel}${post}`;
  });
  if (s !== orig) writeFileSync(absFile, s);
}
function gitmv(from, to) {
  if (existsSync(to)) return; // already relocated (idempotent re-run)
  absolutizeRelatives(from);
  mkdirSync(dirname(to), { recursive: true });
  for (let i = 0; ; i++) {
    try { execSync(`git mv "${posix(from)}" "${posix(to)}"`, { stdio: ['ignore', 'ignore', 'pipe'] }); return; }
    catch (e) { if (i >= 6) { console.error(`FAILED: ${from}\n${e.stderr || e.message}`); process.exit(1); } }
  }
}
const moves = [];
for (const [oldRel, newRel] of pairs) {
  const base = join(SRC, oldRel);
  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const f of walkFiles(base)) gitmv(f, join(SRC, newRel, f.slice(base.length + 1)));
  } else if (existsSync(base + '.tsx')) { gitmv(base + '.tsx', join(SRC, newRel) + '.tsx'); }
  else if (existsSync(base + '.ts')) { gitmv(base + '.ts', join(SRC, newRel) + '.ts'); }
  else { console.error(`NOT FOUND: ${base}`); process.exit(1); }
  moves.push({ oldRel, newRel });
}

// 2) rewrite `@/<old>` -> `@/<new>` (boundary = quote or slash) across src/.
const rules = moves.map(({ oldRel, newRel }) => ({
  re: new RegExp('@/' + escapeRe(oldRel) + "(?=['\"`/])", 'g'),
  to: '@/' + newRel,
}));
function walk(d) {
  const out = [];
  for (const n of readdirSync(d)) {
    const f = join(d, n);
    if (statSync(f).isDirectory()) { if (n !== 'node_modules') out.push(...walk(f)); }
    else if (/\.tsx?$/.test(f)) out.push(f);
  }
  return out;
}
let files = 0, hits = 0;
for (const f of walk(SRC)) {
  const orig = readFileSync(f, 'utf8');
  let s = orig;
  for (const { re, to } of rules) s = s.replace(re, () => (hits++, to));
  if (s !== orig) { writeFileSync(f, s); files++; }
}
console.log(`moved ${moves.length} path(s); rewrote ${hits} import specifier(s) across ${files} file(s)`);
