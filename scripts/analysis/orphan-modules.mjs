#!/usr/bin/env node
/**
 * Orphan-module inventory — reachability over the resolved import graph.
 *
 * Specified by docs/concepts/golden-paths/node-canvas.md §9 ("What the census
 * fundamentally cannot gate here"): a canvas with no consumer is a REACHABILITY
 * fact, not a text pattern. The census ratchets what is present; only an
 * inventory of what *should* exist finds a module nothing imports. Same
 * instrument shape the doctrine keeps arriving at (orphan ts-rs bindings,
 * unregistered pending-review queues, and now orphan canvases).
 *
 *   node scripts/analysis/orphan-modules.mjs
 *   node scripts/analysis/orphan-modules.mjs --json
 *   node scripts/analysis/orphan-modules.mjs --under src/features/teams
 *   node scripts/analysis/orphan-modules.mjs --delete src/features/teams/sub_canvas
 *
 * --delete <path...>  simulates removing those files/dirs and reports the
 *                     TRANSITIVE CLOSURE: everything that becomes unreachable
 *                     *because* of the deletion, plus anything in the deletion
 *                     set that is STILL reachable from a live entry (= keep).
 *
 * Entry points default to the app's real ones (src/main.tsx, src/App.tsx).
 * Test files are NOT entries: a module kept alive only by its own test is an
 * orphan with a test, which is exactly what this instrument must surface.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const CODE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'];
const RESOLVE_EXT = [...CODE_EXT, '.json', '.css'];

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const values = (name) => {
  const out = [];
  let i = argv.indexOf(name);
  while (i !== -1) {
    for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) out.push(argv[j]);
    i = argv.indexOf(name, i + 1);
  }
  return out;
};

const ENTRIES = (values('--entry').length ? values('--entry') : ['src/main.tsx', 'src/App.tsx']).map((p) =>
  path.resolve(ROOT, p),
);
const DELETE_SPECS = values('--delete').map((p) => path.resolve(ROOT, p));
const UNDER = values('--under').map((p) => path.resolve(ROOT, p));
const AS_JSON = flag('--json');

const norm = (p) => p.split(path.sep).join('/');

/** every module under src/ */
const walk = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (CODE_EXT.includes(path.extname(e.name))) acc.push(p);
  }
  return acc;
};
const ALL = walk(SRC).sort();
const ALL_SET = new Set(ALL);

/** a specifier's base path -> the real file it resolves to, or null */
const resolveTo = (base) => {
  if (ALL_SET.has(base)) return base;
  for (const ext of RESOLVE_EXT) if (ALL_SET.has(base + ext)) return base + ext;
  for (const ext of RESOLVE_EXT) if (ALL_SET.has(path.join(base, 'index' + ext))) return path.join(base, 'index' + ext);
  return null;
};

const SPEC_RE =
  /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|import\.meta\.glob\s*\(\s*)(['"`])([^'"`]+)\1/g;
const GLOB_RE = /import\.meta\.glob\s*\(\s*(?:\[\s*)?((?:['"`][^'"`]+['"`]\s*,?\s*)+)/g;

const globToRe = (g) => {
  const body = norm(g)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '@@ANYDIR@@')
    .replace(/\*\*/g, '@@ANY@@')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/@@ANYDIR@@/g, '(?:.*/)?')
    .replace(/@@ANY@@/g, '.*');
  return new RegExp('^' + body + '$');
};

/** every in-tree file this module imports (static, dynamic, side-effect, glob) */
const edgesOf = (file) => {
  const src = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const out = new Set();

  for (const m of src.matchAll(SPEC_RE)) {
    const spec = m[2];
    if (spec.includes('*')) continue; // glob pass owns these
    let base = null;
    if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
    else if (spec.startsWith('.')) base = path.resolve(dir, spec);
    else continue; // bare package specifier
    const hit = resolveTo(base);
    if (hit) out.add(hit);
  }

  for (const g of src.matchAll(GLOB_RE)) {
    for (const lit of g[1].matchAll(/['"`]([^'"`]+)['"`]/g)) {
      const spec = lit[1];
      if (spec.startsWith('!')) continue;
      const base = spec.startsWith('@/') ? path.join(SRC, spec.slice(2)) : path.resolve(dir, spec);
      const re = globToRe(base);
      for (const f of ALL) if (re.test(norm(f))) out.add(f);
    }
  }
  return [...out];
};

const GRAPH = new Map();
for (const f of ALL) {
  try {
    GRAPH.set(f, edgesOf(f));
  } catch {
    GRAPH.set(f, []);
  }
}

const reachable = (entries, removed = new Set()) => {
  const seen = new Set();
  const queue = [];
  for (const e of entries) {
    if (ALL_SET.has(e) && !removed.has(e) && !seen.has(e)) {
      seen.add(e);
      queue.push(e);
    }
  }
  while (queue.length) {
    const cur = queue.pop();
    for (const next of GRAPH.get(cur) ?? []) {
      if (removed.has(next) || seen.has(next) || !ALL_SET.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
};

const rel = (p) => norm(path.relative(ROOT, p));
const isUnder = (p, roots) => roots.some((r) => p === r || p.startsWith(r + path.sep));

const LIVE = reachable(ENTRIES);
const TESTS = ALL.filter((f) => /\.(test|spec)\.(ts|tsx)$/.test(f) || norm(f).includes('/__tests__/'));

const report = { entries: ENTRIES.map(rel), totalModules: ALL.length, reachable: LIVE.size };

if (DELETE_SPECS.length) {
  const seed = ALL.filter((f) => isUnder(f, DELETE_SPECS));
  const removed = new Set(seed);
  const after = reachable(ENTRIES, removed);
  const deadSet = new Set(ALL.filter((f) => !removed.has(f) && !after.has(f) && LIVE.has(f)));
  report.deleteSeed = seed.map(rel);
  report.seedStillReachable = seed.filter((f) => LIVE.has(f)).map(rel);
  report.newlyUnreachable = [...deadSet].map(rel);
  report.reachableAfter = after.size;
  report.testsReferencingRemoved = TESTS.filter((t) =>
    (GRAPH.get(t) ?? []).some((d) => removed.has(d) || deadSet.has(d)),
  ).map(rel);
} else {
  let pool = ALL.filter((f) => !LIVE.has(f));
  if (UNDER.length) pool = pool.filter((f) => isUnder(f, UNDER));
  report.orphanCount = pool.length;
  report.orphans = pool.map(rel);
  report.orphansWithTests = pool.filter((f) => TESTS.some((t) => (GRAPH.get(t) ?? []).includes(f))).map(rel);
}

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`entries            : ${report.entries.join(', ')}`);
  console.log(`modules under src/ : ${report.totalModules}`);
  console.log(`reachable          : ${report.reachable}`);
  if (DELETE_SPECS.length) {
    console.log(`delete seed        : ${report.deleteSeed.length}`);
    console.log(`  still reachable from a live entry (KEEP or re-point): ${report.seedStillReachable.length}`);
    for (const f of report.seedStillReachable) console.log(`      KEEP  ${f}`);
    console.log(`newly unreachable BECAUSE of the deletion (transitive closure): ${report.newlyUnreachable.length}`);
    for (const f of report.newlyUnreachable) console.log(`      DEAD  ${f}`);
    console.log(`tests referencing the removed set: ${report.testsReferencingRemoved.length}`);
    for (const f of report.testsReferencingRemoved) console.log(`      TEST  ${f}`);
  } else {
    console.log(`orphans            : ${report.orphanCount}`);
    for (const f of report.orphans) console.log(`  ${f}${report.orphansWithTests.includes(f) ? '   (has a test)' : ''}`);
  }
}
