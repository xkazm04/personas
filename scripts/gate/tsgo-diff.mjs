#!/usr/bin/env node
// TS 6 `tsc --noEmit` vs the TS 7 native checker: do they report the SAME diagnostics?
//
//   node scripts/gate/tsgo-diff.mjs --native <path to the native tsc binary or bin script>
//   node scripts/gate/tsgo-diff.mjs                 # resolves `typescript-native` from node_modules
//   node scripts/gate/tsgo-diff.mjs --case clean,leaf --json
//
// WHY. The native checker is roughly an order of magnitude faster, and a typecheck gate
// that is fast and WRONG is worse than one that is slow: `npm run check` and `npm run
// build` may only move to it on a zero diagnostic diff - on the clean tree, which a
// checker that checked nothing would also pass, AND on the two red seeds parity.mjs uses
// (a leaf type error; a hub signature change whose ~1,400 errors land in files the seed
// never touched). Diagnostics are compared as file + code + line.
//
// The gate DAEMON stays on the TS 6 API whatever this says: TS 7.0 has no programmatic
// API, and the daemon is a warm `SemanticDiagnosticsBuilderProgram`.
//
// Both runs pass `--incremental false`: a TS 6 tsBuildInfo must not be read by TS 7 or
// the reverse, and a timing that includes one compiler's warm cache compares nothing.
//
// Exit: 0 zero diff on every case, 1 a diff, 2 could not run.

import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { gitTopLevel } from './overlay.mjs';
import { CASES, seed } from './parity-seeds.mjs';

const argv = process.argv.slice(2);
const optOf = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const asJson = argv.includes('--json');
const root = gitTopLevel(process.cwd());
const log = (s) => process.stderr.write(s + '\n');
const req = createRequire(path.join(root, 'package.json'));

function resolveNative() {
  const given = optOf('native');
  if (given) return path.resolve(given);
  for (const pkg of ['typescript-native', '@typescript/native-preview']) {
    try {
      const dir = path.dirname(req.resolve(`${pkg}/package.json`));
      for (const bin of ['bin/tsc', 'bin/tsgo', 'bin/tsgo.js']) if (fs.existsSync(path.join(dir, bin))) return path.join(dir, bin);
    } catch {
      // not installed under this name
    }
  }
  return null;
}

const native = resolveNative();
if (!native || !fs.existsSync(native)) {
  log('tsgo-diff: no native checker found. Pass --native <path>, or install one as `typescript-native` (npm alias of typescript@7).');
  process.exit(2);
}
const ts6 = path.join(path.dirname(req.resolve('typescript/package.json')), 'bin', 'tsc');

function check(bin) {
  // A .exe runs directly; the packages' bin/* entries are node scripts.
  const direct = /\.exe$/i.test(bin);
  const args = [...(direct ? [] : [bin]), '--noEmit', '--incremental', 'false', '-p', 'tsconfig.json'];
  const t0 = performance.now();
  const r = spawnSync(direct ? bin : process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
  const ms = Math.round(performance.now() - t0);
  if (r.error) throw new Error(`${bin}: ${r.error.message}`);
  const out = (r.stdout || '') + '\n' + (r.stderr || '');
  const set = new Set();
  const re = /^(.+?)\((\d+),\d+\): error TS(\d+):/gm;
  let m;
  while ((m = re.exec(out))) set.add(`${m[1].split('\\').join('/')}|TS${m[3]}|${m[2]}`);
  // A failing exit with nothing parsed is a crash or an option error, not "zero diagnostics".
  if (r.status !== 0 && set.size === 0) throw new Error(`${path.basename(bin)} exited ${r.status} with no parseable diagnostics: ${out.trim().slice(0, 600)}`);
  return { ok: r.status === 0, set, ms };
}

const wanted = (optOf('case') ?? 'clean,leaf,hub').split(',').map((s) => s.trim()).filter(Boolean);
const report = { root, ts6, native, cases: [] };
let diffs = 0;

for (const name of wanted) {
  const spec = CASES[name];
  if (!spec) {
    log(`tsgo-diff: unknown case ${name}`);
    process.exit(2);
  }
  let undo = null;
  const onSignal = () => {
    try {
      undo?.();
    } finally {
      process.exit(130);
    }
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    undo = seed(root, spec);
    const a = check(ts6);
    const b = check(native);
    const onlyTs6 = [...a.set].filter((x) => !b.set.has(x)).sort();
    const onlyNative = [...b.set].filter((x) => !a.set.has(x)).sort();
    const same = onlyTs6.length === 0 && onlyNative.length === 0 && a.ok === b.ok;
    if (!same) diffs++;
    report.cases.push({ case: name, same, ts6: { ok: a.ok, n: a.set.size, ms: a.ms }, native: { ok: b.ok, n: b.set.size, ms: b.ms }, onlyTs6: onlyTs6.slice(0, 40), onlyNative: onlyNative.slice(0, 40), onlyTs6Count: onlyTs6.length, onlyNativeCount: onlyNative.length });
    log(`tsgo-diff: ${name.padEnd(6)} ${same ? 'SAME' : 'DIFF'}  ts6 ${a.ok ? 'ok' : 'FAIL'}/${a.set.size} ${a.ms} ms   native ${b.ok ? 'ok' : 'FAIL'}/${b.set.size} ${b.ms} ms${same ? '' : `   onlyTs6 ${onlyTs6.length} onlyNative ${onlyNative.length}`}`);
  } catch (e) {
    log(`tsgo-diff: could not compare ${name}: ${e.message || e}`);
    try {
      undo?.();
    } finally {
      undo = null;
    }
    if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exit(2);
  } finally {
    undo?.();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

report.zeroDiff = diffs === 0;
if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
log(diffs === 0 ? `tsgo-diff: ZERO DIFF on ${wanted.length} case(s)` : `tsgo-diff: ${diffs} case(s) DIFFER`);
process.exit(diffs === 0 ? 0 : 1);
