#!/usr/bin/env node
// Mutation run over ONE module: how much do its tests actually constrain it?
//
//   node scripts/mutation/run-mutation.mjs <target.ts> <test-file> [--list] [--json <out.json>] [--timeout <ms>]
//
// Example:
//   node scripts/mutation/run-mutation.mjs src/features/agents/shared/designContext.ts \
//     src/features/agents/shared/__tests__/designContext.test.ts
//
// For every mutant (one operator flipped at one site) the target file is
// rewritten in place, the test file runs under Vitest, and the original is
// restored. A failing run KILLS the mutant; a passing run means the tests did
// not notice the behaviour change, and the site is printed as SURVIVED.
//
// The script rewrites a tracked source file while it runs, so run it in your
// own worktree, never in a checkout siblings are committing from. The original
// is restored after every mutant, on Ctrl-C, and on a crash. If a run is killed
// harder than that, `git checkout -- <target>` restores the file.
//
// No dependency: Stryker would need a network install and a config file the
// gates would then have to own. The operator set is deliberately small and
// textual, and docs/development/mutation-testing.md lists what it does not
// catch. Exit 0 = ran (whatever the score), 1 = usage error, 2 = the tests
// already fail on unmutated code, so a score would mean nothing.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The operators. Each regex runs over the source; a match only counts when every
 * character of it is code, not inside a string or a comment. Comparison
 * operators are matched with surrounding spaces so `=>` and TS generics
 * (`Map<string, T>`) are never hit.
 */
export const OPERATORS = [
  { name: 'equality', find: /===/g, to: '!==' },
  { name: 'equality', find: /!==/g, to: '===' },
  { name: 'logical', find: /&&/g, to: '||' },
  { name: 'logical', find: /\|\|/g, to: '&&' },
  { name: 'boundary', find: / >= /g, to: ' > ' },
  { name: 'boundary', find: / <= /g, to: ' < ' },
  { name: 'boundary', find: / > /g, to: ' >= ' },
  { name: 'boundary', find: / < /g, to: ' <= ' },
  { name: 'boolean', find: /\btrue\b/g, to: 'false' },
  { name: 'boolean', find: /\bfalse\b/g, to: 'true' },
];

/** One boolean per character: true where the character is code, false inside a string or comment. */
export function codeMask(source) {
  const mask = new Array(source.length).fill(true);
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    let end = -1;
    if (c === '/' && next === '/') {
      end = source.indexOf('\n', i);
      if (end === -1) end = source.length;
    } else if (c === '/' && next === '*') {
      end = source.indexOf('*/', i + 2);
      end = end === -1 ? source.length : end + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      end = i + 1;
      while (end < source.length && source[end] !== c) end += source[end] === '\\' ? 2 : 1;
      end = Math.min(end + 1, source.length);
    }
    if (end === -1) {
      i += 1;
    } else {
      for (let k = i; k < end; k++) mask[k] = false;
      i = end;
    }
  }
  return mask;
}

/** Every mutant of `source`, in source order: `{ index, length, from, to, operator, line, column, mutated }`. */
export function generateMutants(source) {
  const mask = codeMask(source);
  const mutants = [];
  for (const op of OPERATORS) {
    for (const match of source.matchAll(op.find)) {
      const index = match.index ?? 0;
      const length = match[0].length;
      let isCode = true;
      for (let k = index; k < index + length; k++) if (!mask[k]) isCode = false;
      if (!isCode) continue;
      const before = source.slice(0, index);
      const line = before.split('\n').length;
      const column = index - before.lastIndexOf('\n');
      mutants.push({
        index,
        length,
        from: match[0].trim(),
        to: op.to.trim(),
        operator: op.name,
        line,
        column,
        mutated: source.slice(0, index) + op.to + source.slice(index + length),
      });
    }
  }
  return mutants.sort((a, b) => a.index - b.index);
}

function runTests(testFile, timeout) {
  const isWindows = process.platform === 'win32';
  const result = spawnSync(isWindows ? 'npx.cmd' : 'npx', ['vitest', 'run', testFile], {
    encoding: 'utf8',
    stdio: 'pipe',
    shell: isWindows,
    timeout,
  });
  if (result.error && result.error.code === 'ETIMEDOUT') return 'timeout';
  return result.status === 0 ? 'pass' : 'fail';
}

function parseArgs(argv) {
  const args = { positional: [], list: false, json: null, timeout: 120_000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') args.list = true;
    else if (a === '--json') args.json = argv[++i];
    else if (a === '--timeout') args.timeout = Number(argv[++i]);
    else args.positional.push(a);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const [target, testFile] = args.positional;
  if (!target || (!testFile && !args.list) || !existsSync(target) || (testFile && !existsSync(testFile))) {
    console.error('usage: node scripts/mutation/run-mutation.mjs <target.ts> <test-file> [--list] [--json <out.json>] [--timeout <ms>]');
    process.exit(1);
  }

  const original = readFileSync(target, 'utf8');
  const mutants = generateMutants(original);
  const shown = relative(process.cwd(), resolve(target)).replace(/\\/g, '/');

  if (args.list) {
    for (const m of mutants) console.log(`${shown}:${m.line}:${m.column}  ${m.from} -> ${m.to}  (${m.operator})`);
    console.log(`${mutants.length} mutant(s)`);
    return;
  }

  const restore = () => writeFileSync(target, original);
  process.on('SIGINT', () => {
    restore();
    process.exit(130);
  });

  if (runTests(testFile, args.timeout) !== 'pass') {
    console.error(`the tests fail on the UNMUTATED ${shown}; fix them first, a score over a red suite means nothing`);
    process.exit(2);
  }

  const results = [];
  try {
    mutants.forEach((m, n) => {
      writeFileSync(target, m.mutated);
      const outcome = runTests(testFile, args.timeout);
      restore();
      // A timeout counts as killed: the mutant changed behaviour enough to hang the suite.
      const status = outcome === 'pass' ? 'survived' : 'killed';
      results.push({ line: m.line, column: m.column, from: m.from, to: m.to, operator: m.operator, status });
      console.log(`[${n + 1}/${mutants.length}] ${status.toUpperCase().padEnd(8)} ${shown}:${m.line}:${m.column}  ${m.from} -> ${m.to}`);
    });
  } finally {
    restore();
  }

  const killed = results.filter((r) => r.status === 'killed').length;
  const score = results.length === 0 ? null : Math.round((killed / results.length) * 1000) / 10;
  console.log(`\n${shown}: ${killed}/${results.length} mutants killed${score === null ? '' : ` (score ${score}%)`}`);
  for (const r of results.filter((x) => x.status === 'survived')) {
    console.log(`  survived: ${shown}:${r.line}:${r.column}  ${r.from} -> ${r.to}`);
  }

  if (args.json) {
    const report = { target: shown, testFile: testFile.replace(/\\/g, '/'), measuredAt: new Date().toISOString(), killed, total: results.length, score, results };
    writeFileSync(args.json, `${JSON.stringify(report, null, 2)}\n`);
  }
}

// Run only as a CLI, so a test can import the pure functions above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
