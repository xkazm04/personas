#!/usr/bin/env node
// scripts/docs/check-doc-counts.mjs - hold the numbers the docs quote to the tree they describe.
//
// The command table is generated from .ai/manifest.yaml (.ai/project-commands.mjs); the
// counts in the prose were the remaining hand-maintained facts an agent reads as truth:
// "130+ built-in connectors", "14 languages", "14 codegen tasks", "2,400+ tests". Each is
// declared below as a CLAIM (a file and a pattern) against a FACT (a measurement of the
// tree), and judged:
//   N+  (floor)  holds while  N <= actual < 2N. Below N it overstates; at 2N or more the
//                docs understate the codebase by half, which misleads as badly.
//   N   (exact)  holds only when actual === N.
// A claim whose pattern matches NOTHING in its file fails too: a check that found nothing
// is assumed broken, not passed (the census's fail-loud contract). Reword a sentence, and
// this file must be told.
//
// Usage:
//   node scripts/docs/check-doc-counts.mjs     # exit 1 if any claim is stale or missing
//
// src/__tests__/structural/docCounts.test.ts runs the same check over every file an agent
// may edit, so `npm test` fails when README.md or CONTRIBUTING.md drifts. .claude/CLAUDE.md
// is READ_ONLY here: agent lanes cannot edit it, so its drift is reported for a human and
// left out of the test. Zero-dependency on purpose, like .ai/project-commands.mjs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Files whose drift is reported for a human instead of gated (agents cannot edit them). */
export const READ_ONLY = new Set(['.claude/CLAUDE.md']);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'target']);

function walk(dir, onFile) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // intentional: an absent optional tree (e.g. tests/playwright) holds no files
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, onFile);
    else onFile(abs, name);
  }
}

/** Every measurable fact a doc may quote. `approximate` marks a lower-bound measurement. */
export const FACTS = {
  connectors: {
    what: 'built-in connector definitions (scripts/connectors/builtin/*.json, minus *-template.json)',
    measure: (root) =>
      readdirSync(join(root, 'scripts/connectors/builtin')).filter(
        (f) => f.endsWith('.json') && !f.endsWith('-template.json'),
      ).length,
  },
  languages: {
    what: 'UI locales (src/i18n/locales/*.json)',
    measure: (root) => readdirSync(join(root, 'src/i18n/locales')).filter((f) => f.endsWith('.json')).length,
  },
  codegenTasks: {
    what: 'codegen tasks (the TASKS map in scripts/run-codegen.mjs)',
    measure: (root) => countCodegenTasks(readFileSync(join(root, 'scripts/run-codegen.mjs'), 'utf8')),
  },
  vitestTests: {
    what: 'Vitest it()/test() call sites in src/**/*.test.ts(x) and tests/playwright/**/*.test.ts',
    approximate: true,
    measure: (root) => {
      let n = 0;
      const count = (abs, name) => {
        if (/\.test\.tsx?$/.test(name)) n += countTestCalls(readFileSync(abs, 'utf8'));
      };
      walk(join(root, 'src'), count);
      walk(join(root, 'tests/playwright'), count);
      return n;
    },
  },
};

/** Where each fact is quoted. `pattern` is global; group 1 is the number, group 2 an optional `+`. */
export const CLAIMS = [
  { fact: 'connectors', file: 'README.md', pattern: /(\d[\d,]*)(\+?)\s+built-in connectors/g },
  // No `languages` claims since 2026-10-25: the docs say "English only" (SHIPPED_UI_LOCALES),
  // and the locale-file count the `languages` fact measures is no longer what ships.
  { fact: 'codegenTasks', file: '.claude/CLAUDE.md', pattern: /(\d[\d,]*)(\+?)\s+codegen tasks/g },
  { fact: 'vitestTests', file: '.claude/CLAUDE.md', pattern: /Vitest \((\d[\d,]*)(\+?)\s+tests\)/g },
];

/** Entries of the `const TASKS = { ... };` map: one `name: "scripts/..."` line each. */
export function countCodegenTasks(source) {
  const start = source.indexOf('const TASKS = {');
  if (start === -1) return 0;
  const end = source.indexOf('\n};', start);
  const block = source.slice(start, end === -1 ? undefined : end);
  return (block.match(/^\s*(?:"[\w-]+"|[\w-]+)\s*:\s*"scripts\//gm) || []).length;
}

/** `it(` / `test(` call sites at line start, modifiers included (`it.each(`, `test.skip(`). */
export function countTestCalls(source) {
  return (source.match(/^\s*(?:it|test)(?:\.\w+)*\s*[(`]/gm) || []).length;
}

/** 'ok' | 'overstated' | 'understated' | 'wrong' for one quoted number against the measurement. */
export function judge(claimed, isFloor, actual) {
  if (isFloor) {
    if (actual < claimed) return 'overstated';
    if (actual >= 2 * claimed) return 'understated';
    return 'ok';
  }
  return actual === claimed ? 'ok' : 'wrong';
}

/**
 * Judge every claim in `files` (default: every file a claim names).
 * Returns [{ file, line, fact, quoted, claimed, isFloor, actual, verdict }]; a claim whose
 * pattern matched nothing yields one entry with verdict 'missing' and line 0.
 */
export function checkClaims({ root = ROOT, files } = {}) {
  const measured = new Map();
  const measure = (fact) => {
    if (!measured.has(fact)) measured.set(fact, FACTS[fact].measure(root));
    return measured.get(fact);
  };
  const results = [];
  for (const claim of CLAIMS) {
    if (files && !files.includes(claim.file)) continue;
    const text = readFileSync(join(root, claim.file), 'utf8').replace(/\r\n/g, '\n');
    const matches = [...text.matchAll(claim.pattern)];
    if (matches.length === 0) {
      results.push({ file: claim.file, line: 0, fact: claim.fact, quoted: claim.pattern.source, verdict: 'missing' });
      continue;
    }
    const actual = measure(claim.fact);
    for (const m of matches) {
      const claimed = Number(m[1].replace(/,/g, ''));
      const isFloor = m[2] === '+';
      results.push({
        file: claim.file,
        line: text.slice(0, m.index).split('\n').length,
        fact: claim.fact,
        quoted: m[0],
        claimed,
        isFloor,
        actual,
        verdict: judge(claimed, isFloor, actual),
      });
    }
  }
  return results;
}

function main() {
  const results = checkClaims();
  let bad = 0;
  for (const r of results) {
    const where = `${r.file}:${r.line}`;
    if (r.verdict === 'ok') {
      console.log(`  [OK] ${where} "${r.quoted}" (measured ${r.actual})`);
      continue;
    }
    bad += 1;
    const owner = READ_ONLY.has(r.file) ? ' - needs a human: agent lanes cannot edit this file' : '';
    if (r.verdict === 'missing') {
      console.error(`  [MISSING] ${r.file}: /${r.quoted}/ matched nothing; update CLAIMS in this script${owner}`);
    } else {
      const fact = FACTS[r.fact];
      const approx = fact.approximate ? ' (approximate lower bound)' : '';
      console.error(`  [${r.verdict.toUpperCase()}] ${where} "${r.quoted}" but measured ${r.actual}${approx}: ${fact.what}${owner}`);
    }
  }
  if (bad > 0) {
    console.error(`\n${bad} quoted count(s) out of step with the tree. Fix the prose, or the claim registry if the sentence moved.`);
    process.exitCode = 1;
  }
}

const isMain = Boolean(process.argv[1]) && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) main();
