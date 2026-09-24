#!/usr/bin/env node
// Gate parity: the daemon's verdict must equal the cold commands' verdict on a tree
// that is actually RED, not only on a clean one.
//
//   npm run gate:parity                 # all five cases
//   node scripts/gate/parity.mjs --case hub,census
//   node scripts/gate/parity.mjs --json
//
// WHY THIS EXISTS. docs/architecture/warm-verification-service.md held the daemon out
// of lefthook pre-push "until parity tests run against a tree with real type errors".
// The 2026-09-07 parity evidence was 0 errors == 0 errors, which a daemon that checked
// nothing would also have produced. This seeds five states and compares, per gate,
// the EXIT verdict and the DIAGNOSTIC SET:
//
//   clean   the tree as it stands
//   leaf    a real type error in a new leaf file nothing imports
//   hub     a signature change in src/lib/silentCatch.ts (hundreds of importers), so
//           the errors land in files the seed never touched: the case an overlay that
//           forgot to recheck dependents would get wrong
//   census  a census RISE (a raw <select> in a new file)
//   eslint  an error-level lint violation (custom/no-silent-catch)
//
// SEEDING NEVER LEAVES A MARK. New files live in one directory that is removed in
// `finally`; the one tracked file that is edited must be clean before the seed
// (`git diff --quiet`), is restored from the bytes read before the edit, and is then
// verified twice: sha256 of the bytes and `git diff --quiet -- <file>`. The script
// never touches the index.
//
// Exit: 0 parity on every case run, 1 any mismatch, 2 could not run (a seed target is
// dirty, the daemon could not answer). "Could not compare" is never reported as parity:
// a gate the daemon answered COLD is a failure of this test, not a pass.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { gitTopLevel, baseRootOf, sameDirectory } from './overlay.mjs';
import { CASES, seed } from './parity-seeds.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const optOf = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const asJson = argv.includes('--json');
const root = gitTopLevel(process.cwd());
const baseRoot = baseRootOf(root);
const isBase = sameDirectory(root, baseRoot);

// Every full-run ESLint cache lives here (see lefthook.yml and package.json `lint`).
const ESLINT_CACHE = 'node_modules/.cache/eslint/full/';


const log = (s) => process.stderr.write(s + '\n');

function run(cmd, args) {
  const t0 = performance.now();
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', ms: Math.round(performance.now() - t0) };
}

// eslint's `exports` map hides bin/eslint.js from require.resolve, so resolve the package
// root and join: the same file `npx eslint` would run, without npx's shell.
const resolveBin = (rel) => {
  const [pkg, ...rest] = rel.split('/');
  const pkgJson = createRequire(path.join(root, 'package.json')).resolve(`${pkg}/package.json`);
  return path.join(path.dirname(pkgJson), ...rest);
};

/** Repo-relative posix path, whichever checkout the absolute form names. */
function rel(file) {
  let p = String(file).replace(/\\/g, '/');
  for (const prefix of [root, baseRoot]) {
    if (p.toLowerCase().startsWith(prefix.toLowerCase() + '/')) p = p.slice(prefix.length + 1);
  }
  return p.replace(/^\.\//, '');
}

// ---------------------------------------------------------------------------
// the cold side: the exact commands pre-push and `npm run check` run
function coldTsc() {
  const r = run(process.execPath, [resolveBin('typescript/bin/tsc'), '--noEmit']);
  const set = new Set();
  const re = /^(.+?)\((\d+),\d+\): error TS(\d+):/gm;
  let m;
  while ((m = re.exec(r.stdout + '\n' + r.stderr))) set.add(`${rel(m[1])}|TS${m[3]}|${m[2]}`);
  return { ok: r.status === 0, set, ms: r.ms };
}

function coldCensus() {
  const r = run(process.execPath, ['scripts/census/run-census.mjs', '--check', '--json']);
  const parsed = JSON.parse(r.stdout);
  const set = new Set(parsed.rules.filter((x) => (x.problems ?? []).length > 0).map((x) => x.id));
  return { ok: r.status === 0, set, ms: r.ms };
}

function coldEslint() {
  const r = run(process.execPath, [resolveBin('eslint/bin/eslint.js'), '--cache', '--cache-location', ESLINT_CACHE, '--format', 'json', 'src/']);
  const set = new Set();
  for (const f of JSON.parse(r.stdout)) {
    for (const msg of f.messages) if (msg.severity === 2) set.add(`${rel(f.filePath)}|${msg.ruleId}|${msg.line}`);
  }
  return { ok: r.status === 0, set, ms: r.ms };
}

// ---------------------------------------------------------------------------
// the warm side
function warm() {
  const r = run(process.execPath, [path.join(HERE, 'gate.mjs'), '--root', root, '--gates', 'tsc,eslint,census', '--json']);
  let response;
  try {
    response = JSON.parse(r.stdout);
  } catch {
    throw new Error(`gate client printed no JSON (exit ${r.status}): ${(r.stderr || r.stdout).slice(0, 400)}`);
  }
  const out = { ms: r.ms, exit: r.status };
  for (const g of ['tsc', 'eslint', 'census']) {
    const v = response[g];
    if (!v || v.unavailable || v.cold || response.cold) throw new Error(`daemon did not answer ${g} warm (${(v && v.reason) || 'cold fallback'}); parity cannot be claimed`);
  }
  out.tsc = { ok: response.tsc.ok, set: new Set(response.tsc.errors.map((e) => `${rel(e.file)}|TS${e.code}|${e.line}`)), introduced: response.tsc.introduced?.length ?? null };
  out.census = {
    ok: response.census.ok,
    set: new Set([...response.census.drift.map((d) => d.rule), ...response.census.structural.map((s) => s.rule)]),
    introduced: response.census.introduced?.length ?? null,
    inherited: response.census.delta ? response.census.drift.length - (response.census.introduced?.length ?? 0) : 0,
  };
  // The worker reports warnings too and names the rule `ruleId`; the client's cold path names it
  // `code` and keeps errors only. Compare error-level findings, whichever spelling arrived.
  const lintErrors = (response.eslint.messages ?? []).filter((e) => e.severity === undefined || e.severity === 'error' || e.severity === 2);
  out.eslint = { ok: response.eslint.ok, set: new Set(lintErrors.map((e) => `${rel(e.file)}|${e.ruleId ?? e.code}|${e.line}`)) };
  return out;
}

function diffSets(a, b) {
  const onlyCold = [...a].filter((x) => !b.has(x)).sort();
  const onlyWarm = [...b].filter((x) => !a.has(x)).sort();
  return { onlyCold, onlyWarm, equal: onlyCold.length === 0 && onlyWarm.length === 0 };
}


let pendingUndo = null;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try {
      pendingUndo?.();
    } finally {
      process.exit(130);
    }
  });
}

// ---------------------------------------------------------------------------
const wanted = (optOf('case') ?? Object.keys(CASES).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
for (const c of wanted) {
  if (!CASES[c]) {
    log(`parity: unknown case ${c} (known: ${Object.keys(CASES).join(',')})`);
    process.exit(2);
  }
}

const report = { root, base: baseRoot, mode: isBase ? 'base (zero-error semantics)' : 'worktree (delta semantics)', cases: [] };
let mismatches = 0;

for (const name of wanted) {
  const spec = CASES[name];
  log(`parity: case ${name} (${spec.note})`);
  const row = { case: name, gates: {} };
  try {
    pendingUndo = seed(root, spec);
    const cold = { tsc: coldTsc(), census: coldCensus(), eslint: coldEslint() };
    const hot = warm();
    for (const g of ['tsc', 'census', 'eslint']) {
      const d = diffSets(cold[g].set, hot[g].set);
      const verdictEqual = cold[g].ok === hot[g].ok;
      const ok = d.equal && verdictEqual;
      if (!ok) mismatches++;
      row.gates[g] = {
        parity: ok,
        cold: { ok: cold[g].ok, n: cold[g].set.size, ms: cold[g].ms },
        warm: { ok: hot[g].ok, n: hot[g].set.size, introduced: hot[g].introduced, inherited: hot[g].inherited },
        onlyCold: d.onlyCold.slice(0, 20),
        onlyWarm: d.onlyWarm.slice(0, 20),
      };
      log(`  ${g.padEnd(6)} ${ok ? 'PARITY  ' : 'MISMATCH'} cold ${cold[g].ok ? 'ok' : 'FAIL'}/${cold[g].set.size}  warm ${hot[g].ok ? 'ok' : 'FAIL'}/${hot[g].set.size}${d.equal ? '' : `  onlyCold ${d.onlyCold.length} onlyWarm ${d.onlyWarm.length}`}`);
    }
    row.warmMs = hot.ms;
  } catch (e) {
    row.error = String(e.message || e);
    log(`  could not compare: ${row.error}`);
    report.cases.push(row);
    try {
      pendingUndo?.();
    } finally {
      pendingUndo = null;
    }
    if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exit(2);
  } finally {
    pendingUndo?.();
    pendingUndo = null;
  }
  report.cases.push(row);
}

report.parity = mismatches === 0;
if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
log(mismatches === 0 ? `parity: HELD on ${wanted.length} case(s)` : `parity: ${mismatches} gate verdict(s) MISMATCHED`);
process.exit(mismatches === 0 ? 0 : 1);
