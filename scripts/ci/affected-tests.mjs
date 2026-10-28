#!/usr/bin/env node
/**
 * affected-tests — pick the Vitest files a change can reach, without Vitest.
 *
 * WHY THIS EXISTS. CI's fast lane ran `vitest run --changed <base>`. Vitest
 * answers that by walking the import graph of EVERY spec (~1,760) in its main
 * process at once, keeping each walk until all finish. On a GitHub runner that
 * exhausted the 4 GB heap before a single test ran - every fast-lane push from
 * 2026-10-05 to 2026-10-25, whatever changed (a lockfile, five files, thirteen).
 * The lazy i18n glob made each walk ~5x bigger, but the shape was the problem:
 * the walk's cost is all-specs x what-each-reaches, however small the change.
 *
 * This builds ONE reverse dependency graph of the repo's tracked sources
 * (regex, no parser: an extra edge only over-selects, which is safe) and
 * searches upward from the changed files to the test files. Vitest then runs
 * an explicit list (`vitest run <files>`) and never walks anything.
 *
 * Edges: static/dynamic/side-effect imports and re-exports, `vi.mock(...)` /
 * `vi.importActual(...)` targets, `new URL(..., import.meta.url)` (workers),
 * and literal `import.meta.glob(...)` patterns. `import type` / `export type`
 * edges are skipped: they are erased before a test runs. Bare package imports
 * are skipped (node_modules is not in the graph; a dependency change is a
 * lockfile change, which selects everything).
 *
 * Usage:
 *   node scripts/ci/affected-tests.mjs --changed-list <file>   # one path per line (CI: from `changes`)
 *   node scripts/ci/affected-tests.mjs --base <sha>            # git diff <sha> HEAD
 *   node scripts/ci/affected-tests.mjs --files a.ts b.tsx      # explicit
 *   [--github-output]   append fe_tests=<none|list|all> and fe_test_files=<...> to $GITHUB_OUTPUT
 *   [--max <n>]         above n selected files, answer `all` (sharded run) instead; default 300
 *   [--explain <test>]  print the chain from a changed file to this test file
 *
 * Exit 0 with a verdict; exit 1 only when it could not read its inputs.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// ── What vitest.config.ts runs, and what re-runs all of it ───────────────
// KEEP IN STEP with vitest.config.ts `include` / `exclude` / `forceRerunTriggers`.
const isTest = (f) =>
  (/^src\/.*\.test\.(ts|tsx)$/.test(f) || /^tests\/playwright\/.*\.test\.ts$/.test(f)) && !f.startsWith('src/test/e2e/');
const RUN_ALL = [
  /^package\.json$/,
  /^package-lock\.json$/, // a dependency moved: any test can change behaviour
  /^vitest\.config\.[cm]?[jt]s$/,
  /^vite\.config\.[cm]?[jt]s$/,
  /^tsconfig(\.[a-z]+)?\.json$/,
  /^src\/test\//, // the setup file and shared helpers reach every test but are imported by none through the graph
];

// ── The file universe ──────────────────────────────────────────────────
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
// Tracked plus untracked-not-ignored, so a new file in a local run is a node too.
const tracked = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean);
const universe = new Set(tracked);
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const sources = tracked.filter((f) => SOURCE.test(f) && (f.startsWith('src/') || f.startsWith('tests/playwright/')));

// ── Changed files ──────────────────────────────────────────────────────
let changed;
if (opt('--changed-list')) {
  const file = opt('--changed-list');
  if (!existsSync(file)) {
    console.error(`affected-tests: --changed-list ${file} does not exist.`);
    process.exit(1);
  }
  changed = readFileSync(file, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
} else if (opt('--base')) {
  changed = git('diff', '--name-only', '--no-renames', opt('--base'), 'HEAD').split('\n').filter(Boolean);
} else if (args.includes('--files')) {
  const rest = args.slice(args.indexOf('--files') + 1);
  const end = rest.findIndex((a) => a.startsWith('--'));
  changed = (end < 0 ? rest : rest.slice(0, end)).map((f) => f.replace(/\\/g, '/'));
} else {
  console.error('affected-tests: pass --changed-list <file>, --base <sha> or --files <paths...>.');
  process.exit(1);
}

// ── Resolution ─────────────────────────────────────────────────────────
const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '/index.ts', '/index.tsx', '/index.js'];
function resolveSpec(spec, fromFile) {
  const clean = spec.split('?')[0];
  let base;
  if (clean.startsWith('@/')) base = 'src/' + clean.slice(2);
  else if (clean.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), clean));
  else return null; // a package
  for (const ext of EXTS) if (universe.has(base + ext)) return base + ext;
  return null;
}

// Minimal glob for import.meta.glob patterns: `*` within a segment, `**` across.
function globToRegex(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') { re += '.*'; i++; if (pattern[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '{') { const end = pattern.indexOf('}', i); re += '(' + pattern.slice(i + 1, end).split(',').map(escapeRe).join('|') + ')'; i = end; }
    else re += escapeRe(c);
  }
  return new RegExp('^' + re + '$');
}
function escapeRe(s) { return s.replace(/[.+^${}()|[\]\\?]/g, '\\$&'); }
function expandGlob(patterns, fromFile) {
  const out = [];
  const neg = [];
  for (const p of patterns) {
    const negated = p.startsWith('!');
    const raw = negated ? p.slice(1) : p;
    const abs = raw.startsWith('@/') ? 'src/' + raw.slice(2)
      : raw.startsWith('/') ? raw.slice(1)
      : path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), raw));
    (negated ? neg : out).push(globToRegex(abs));
  }
  return tracked.filter((f) => out.some((r) => r.test(f)) && !neg.some((r) => r.test(f)));
}

// ── Edges ──────────────────────────────────────────────────────────────
const IMPORT_FROM = /\b(import|export)\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"\n]+)['"]/g;
const DYNAMIC = /\b(?:import|vi\.mock|vi\.doMock|vi\.importActual|vi\.importMock|require)\s*\(\s*['"]([^'"\n]+)['"]/g;
const URL_META = /new\s+URL\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url/g;
// The type argument may nest (`glob<Partial<Def>>(`), so it runs to the first `(`.
const GLOB = /import\.meta\.glob(?:<[^(]*>)?\(\s*(\[[\s\S]*?\]|'[^']*'|"[^"]*")/g;

const reverse = new Map(); // dependency -> Set(importers)
const addEdge = (from, to) => {
  if (!to || to === from) return;
  if (!reverse.has(to)) reverse.set(to, new Set());
  reverse.get(to).add(from);
};
for (const file of sources) {
  let text;
  try { text = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
  for (const m of text.matchAll(IMPORT_FROM)) {
    if (m[2]) continue; // `import type` / `export type`: erased
    addEdge(file, resolveSpec(m[3], file));
  }
  for (const m of text.matchAll(DYNAMIC)) addEdge(file, resolveSpec(m[1], file));
  for (const m of text.matchAll(URL_META)) addEdge(file, resolveSpec(m[1], file));
  for (const m of text.matchAll(GLOB)) {
    const patterns = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
    for (const dep of expandGlob(patterns, file)) addEdge(file, dep);
  }
}

// ── Search upward ──────────────────────────────────────────────────────
const trigger = changed.find((f) => RUN_ALL.some((r) => r.test(f)));
const parent = new Map();
const selected = new Set();
if (!trigger) {
  const queue = [];
  for (const f of changed) { parent.set(f, null); queue.push(f); }
  while (queue.length) {
    const f = queue.shift();
    if (isTest(f) && universe.has(f)) selected.add(f);
    for (const importer of reverse.get(f) ?? []) {
      if (parent.has(importer)) continue;
      parent.set(importer, f);
      queue.push(importer);
    }
  }
}

const max = Number(opt('--max') ?? 300);
let mode;
let why;
if (trigger) { mode = 'all'; why = `${trigger} changed, which every test depends on`; }
else if (selected.size > max) { mode = 'all'; why = `${selected.size} test files selected, over --max ${max}: the sharded run is cheaper`; }
else if (selected.size === 0) { mode = 'none'; why = `no test file reaches any of the ${changed.length} changed file(s)`; }
else { mode = 'list'; why = `${selected.size} test file(s) reach the ${changed.length} changed file(s)`; }

const files = [...selected].sort();
console.log(`affected-tests: ${mode} - ${why} (graph: ${sources.length} sources, ${reverse.size} imported files)`);
if (mode === 'list') for (const f of files) console.log(`  ${f}`);

const explain = opt('--explain');
if (explain) {
  if (!parent.has(explain)) console.log(`explain: ${explain} is not reached by any changed file.`);
  else {
    const chain = [];
    for (let f = explain; f; f = parent.get(f)) chain.push(f);
    console.log(`explain: ${chain.reverse().join('\n  <- imported by ')}`.replace(/<- imported by/g, '-> imported by'));
  }
}

if (args.includes('--github-output')) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) {
    console.error('affected-tests: --github-output set but $GITHUB_OUTPUT is not.');
    process.exit(1);
  }
  appendFileSync(out, `fe_tests=${mode}\nfe_test_files=${mode === 'list' ? files.join(' ') : ''}\nfe_tests_why=${why}\n`);
}
