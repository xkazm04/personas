#!/usr/bin/env node
/**
 * check-agents-sub-boundaries.mjs — the `features/agents/sub_*` ownership map, run.
 *
 * `src/features/agents/AGENTS.md` says a helper used by two `sub_` modules belongs
 * in `features/agents/shared/` or `features/shared/`, "NOT inside either sub_ dir".
 * Until this script that sentence was prose: nothing counted the imports that cross
 * from one `sub_` module into another, so the boundary could only decay.
 *
 * WHY NOT A CENSUS RULE. The census matches a pattern against file CONTENT and
 * never sees the file's own directory, so "an import of a sub_ module other than
 * the one this file lives in" is not expressible as one rule; one rule per module
 * does not work either, because a rule that matches nothing anywhere fails the run
 * as a broken matcher, and most modules are clean. The semantics are the census's
 * all the same — a two-sided ratchet:
 *   - a cross-module edge (from -> to) that is NOT in the baseline fails;
 *   - an edge whose count RISES fails;
 *   - an edge whose count DROPS fails until the baseline is re-recorded with
 *     --update (a fix is welcome, but it lands in the diff where a reviewer sees it);
 *   - a walk that sees fewer production files than the baseline's floor fails
 *     (the walker is broken, not the code clean);
 *   - the AGENTS.md table must list exactly the sub_ directories on disk.
 *
 * Counted: `from '…'`, `import '…'` and dynamic `import('…')` specifiers that are
 * either the `@/features/agents/sub_<x>` alias or a relative path resolving into
 * another `sub_` directory. Not counted: tests (`__tests__/`, `*.test.*`,
 * `*.spec.*`) — a test may reach across to mock a neighbour — and files outside the
 * `sub_` dirs (the editor shell in `components/` composing modules is the point).
 *
 * Run by `src/__tests__/structural/agents-sub-boundaries.test.ts`, so it fails
 * `npm test` and the CI test step.
 *
 * Usage:
 *   node scripts/check-agents-sub-boundaries.mjs              # --check (default)
 *   node scripts/check-agents-sub-boundaries.mjs --verbose    # also list every crossing site
 *   node scripts/check-agents-sub-boundaries.mjs --update     # re-record the baseline (a deliberate act)
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const AGENTS_DIR = 'src/features/agents';
export const OWNERSHIP_MAP = `${AGENTS_DIR}/AGENTS.md`;
export const BASELINE = 'scripts/agents-sub-boundaries.baseline.json';

const SOURCE_FILE = /\.tsx?$/;
const TEST_FILE = /(?:^|\/)__tests__\/|\.(?:test|spec)\.tsx?$/;
// `from '…'` (static import / re-export, including the tail of a multi-line one),
// `import('…')` and the side-effect form `import '…'`.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g;
const ALIAS = /^@\/features\/agents\/(sub_\w+)/;
const SUB_PREFIX = `${AGENTS_DIR}/sub_`;

/** The `sub_` module a repo-relative posix path belongs to, or null. */
export function moduleOf(relPath) {
  if (!relPath.startsWith(SUB_PREFIX)) return null;
  return relPath.slice(AGENTS_DIR.length + 1).split('/')[0];
}

/** The `sub_` module an import specifier written in `fromRel` resolves into, or null. */
export function targetOf(fromRel, specifier) {
  const alias = ALIAS.exec(specifier);
  if (alias) return alias[1];
  if (!specifier.startsWith('.')) return null;
  return moduleOf(posix.normalize(posix.join(posix.dirname(fromRel), specifier)));
}

/**
 * Every cross-module import in one source file. Whole-line `//` comments and JSDoc
 * continuation lines are blanked first (keeping line numbers), so prose that quotes
 * an import is not counted. Block comments are deliberately NOT stripped: a glob
 * string such as `'src/**' + '/*.ts'` would open one and swallow real code.
 */
export function edgesInSource(fromRel, source) {
  const from = moduleOf(fromRel);
  if (!from) return [];
  const code = source.replace(/^[ \t]*(?:\/\/|\*).*$/gm, '');
  const out = [];
  for (const m of code.matchAll(SPECIFIER)) {
    const to = targetOf(fromRel, m[2]);
    if (!to || to === from) continue;
    out.push({ from, to, specifier: m[2], file: fromRel, line: code.slice(0, m.index).split('\n').length });
  }
  return out;
}

function walk(absDir, relDir, files) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) walk(join(absDir, entry.name), rel, files);
    else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(rel)) files.push(rel);
  }
  return files;
}

/** Walk every `sub_` module and count the crossings. */
export function measure(root = ROOT) {
  const modules = readdirSync(join(root, AGENTS_DIR), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('sub_'))
    .map((d) => d.name)
    .sort();
  const sites = [];
  let filesSeen = 0;
  for (const mod of modules) {
    for (const rel of walk(join(root, AGENTS_DIR, mod), `${AGENTS_DIR}/${mod}`, [])) {
      filesSeen += 1;
      sites.push(...edgesInSource(rel, readFileSync(join(root, rel), 'utf8')));
    }
  }
  const edges = {};
  for (const s of sites) {
    const key = `${s.from} -> ${s.to}`;
    edges[key] = (edges[key] || 0) + 1;
  }
  return { modules, filesSeen, edges: sortKeys(edges), sites };
}

/** The `sub_` modules the ownership table in AGENTS.md names, in table order-independent form. */
export function documentedModules(root = ROOT) {
  const text = readFileSync(join(root, OWNERSHIP_MAP), 'utf8');
  return [...text.matchAll(/^\|\s*`(sub_\w+)`/gm)].map((m) => m[1]).sort();
}

export function readBaseline(root = ROOT) {
  return JSON.parse(readFileSync(join(root, BASELINE), 'utf8'));
}

/** Every reason the measured tree disagrees with the baseline and the map. Empty = green. */
export function compare(measured, baseline, documented = null) {
  const problems = [];
  if (measured.modules.length === 0) problems.push(`no sub_ directories under ${AGENTS_DIR} - the walk looked at nothing`);
  if (measured.filesSeen < baseline.floor) {
    problems.push(`walk saw ${measured.filesSeen} production files, below the floor of ${baseline.floor} - the walker is broken, not the code clean`);
  }
  const recorded = baseline.edges || {};
  for (const [key, count] of Object.entries(measured.edges)) {
    const was = recorded[key];
    if (was === undefined) problems.push(`NEW crossing ${key} (${count}) - move the shared piece to features/agents/shared/ or features/shared/`);
    else if (count > was) problems.push(`crossing ${key} ROSE ${was} -> ${count}`);
    else if (count < was) problems.push(`crossing ${key} dropped ${was} -> ${count} - re-record with --update`);
  }
  for (const [key, was] of Object.entries(recorded)) {
    if (!(key in measured.edges)) problems.push(`crossing ${key} dropped ${was} -> 0 - re-record with --update`);
  }
  if (documented) {
    for (const mod of measured.modules) if (!documented.includes(mod)) problems.push(`${mod} exists on disk but has no row in ${OWNERSHIP_MAP}`);
    for (const mod of documented) if (!measured.modules.includes(mod)) problems.push(`${OWNERSHIP_MAP} has a row for ${mod}, which does not exist`);
  }
  return problems;
}

function sortKeys(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function main(argv) {
  const measured = measure();
  if (measured.modules.length === 0) {
    console.error(`check-agents-sub-boundaries: no sub_ directories under ${AGENTS_DIR} - nothing was walked.`);
    process.exitCode = 1;
    return;
  }

  if (argv.includes('--verbose')) {
    for (const s of measured.sites) console.log(`${s.file}:${s.line}  ${s.from} -> ${s.to}  '${s.specifier}'`);
    console.log('');
  }

  if (argv.includes('--update')) {
    const previous = readBaseline();
    const next = {
      $comment: previous.$comment,
      floor: previous.floor,
      edges: measured.edges,
    };
    writeFileSync(join(ROOT, BASELINE), `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Re-recorded ${BASELINE}: ${Object.keys(measured.edges).length} crossing(s), ${measured.sites.length} import(s).`);
    return;
  }

  const problems = compare(measured, readBaseline(), documentedModules());
  const total = measured.sites.length;
  console.log(
    `agents sub_ boundaries: ${measured.modules.length} modules, ${measured.filesSeen} production files, ` +
      `${Object.keys(measured.edges).length} crossing pair(s), ${total} crossing import(s).`,
  );
  if (problems.length > 0) {
    for (const p of problems) console.error(`  - ${p}`);
    console.error('\nRun with --verbose for every site. See src/features/agents/AGENTS.md.');
    process.exitCode = 1;
  }
}

const isMain = Boolean(process.argv[1]) && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) main(process.argv.slice(2));
