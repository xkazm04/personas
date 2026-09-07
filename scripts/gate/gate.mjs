#!/usr/bin/env node
// Gate client: `npm run gate` -- asks the warm daemon for a verdict on this root,
// starting the daemon when needed and falling back to the cold commands when it
// cannot be reached. Exit 1 when any gate reports ok === false.
//
//   node scripts/gate/gate.mjs [--root <path>] [--gates tsc,eslint,census,vitest]
//                              [--files a,b] [--json] [--cold] [--status] [--stop]
//                              [--timeout <ms>]

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { computeOverlay, gitTopLevel, baseRootOf, dirtyAgainstHead, toPosix, sameDirectory } from './overlay.mjs';
import { computeFingerprint } from './fingerprint.mjs';
import { readHandshake, removeHandshake, pidAlive, logPath, handshakePath } from './handshake.mjs';

const DEFAULT_GATES = ['tsc', 'eslint', 'census'];
const ALL_GATES = ['tsc', 'eslint', 'census', 'vitest'];
const START_TIMEOUT_MS = 60 * 1000;

function parseArgs(argv) {
  const out = { gates: DEFAULT_GATES, timeout: 900000, json: false, cold: false, status: false, stop: false, deep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') out.root = argv[++i];
    else if (a === '--gates') out.gates = String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--files') out.files = String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--json') out.json = true;
    else if (a === '--cold') out.cold = true;
    else if (a === '--status') out.status = true;
    else if (a === '--deep') out.deep = true;
    else if (a === '--stop') out.stop = true;
    else if (a === '--timeout') out.timeout = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'usage: gate [--root <path>] [--gates tsc,eslint,census,vitest] [--files a,b] [--json] [--cold] [--status] [--stop] [--timeout <ms>]\n',
      );
      process.exit(0);
    } else {
      process.stderr.write(`gate: unknown flag ${a}\n`);
      process.exit(2);
    }
  }
  for (const g of out.gates) {
    if (!ALL_GATES.includes(g)) {
      process.stderr.write(`gate: unknown gate ${g} (known: ${ALL_GATES.join(',')})\n`);
      process.exit(2);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const root = args.root ? toPosix(args.root) : gitTopLevel(process.cwd());
const baseRoot = baseRootOf(root);

// ---------------------------------------------------------------------------
// daemon transport
async function call(hs, method, route, body, timeoutMs) {
  const res = await fetch(`http://127.0.0.1:${hs.port}${route}`, {
    method,
    headers: { 'x-gate-token': hs.token, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { error: text.slice(0, 200) };
  }
  if (!res.ok) {
    const e = new Error(`${res.status} ${json.error || ''}`.trim());
    e.status = res.status;
    throw e;
  }
  return json;
}

async function daemonAlive(hs) {
  if (!hs || !pidAlive(hs.pid)) return false;
  try {
    const st = await call(hs, 'GET', '/status', null, 3000);
    return st && st.pid === hs.pid;
  } catch {
    return false;
  }
}

async function stopDaemon(hs) {
  if (!hs) return;
  try {
    await call(hs, 'POST', '/stop', null, 3000);
  } catch {
    // dead or unreachable; kill by pid as a fallback
    if (pidAlive(hs.pid)) {
      try {
        process.kill(hs.pid);
      } catch {
        // gone
      }
    }
  }
  const deadline = Date.now() + 5000;
  while (pidAlive(hs.pid) && Date.now() < deadline) await sleep(100);
  const cur = readHandshake();
  if (cur && cur.pid === hs.pid) removeHandshake(hs.pid);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function spawnDaemon() {
  fs.mkdirSync(path.dirname(logPath()), { recursive: true });
  const logFd = fs.openSync(logPath(), 'a');
  const daemonPath = fileURLToPath(new URL('./daemon.mjs', import.meta.url));
  // --expose-gc lets the tsc worker release the previous program right after a rebuild
  const child = spawn(process.execPath, ['--expose-gc', daemonPath, '--base', baseRoot], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
    cwd: baseRoot,
    env: { ...process.env, GATE_DAEMON: '1' },
  });
  child.unref();
  fs.closeSync(logFd);
  return child.pid;
}

/** Returns a live handshake for our base, or null with a reason. */
async function ensureDaemon() {
  const fp = computeFingerprint(baseRoot);
  let hs = readHandshake();
  if (hs && !sameDirectory(hs.baseRoot, baseRoot)) {
    if (await daemonAlive(hs)) {
      return { hs: null, reason: `daemon serves a different base (${hs.baseRoot})` };
    }
    hs = null;
  }
  if (hs && (await daemonAlive(hs)) && hs.fingerprint === fp) return { hs };
  if (hs) {
    if (await daemonAlive(hs)) {
      process.stderr.write('gate: fingerprint changed, restarting daemon\n');
    }
    await stopDaemon(hs);
  }
  const pid = spawnDaemon();
  process.stderr.write(`gate: starting daemon (pid ${pid}, log ${logPath()})\n`);
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(250);
    const cur = readHandshake();
    if (cur && cur.pid === pid && (await daemonAlive(cur))) return { hs: cur };
    if (!pidAlive(pid)) return { hs: null, reason: `daemon exited during start (see ${logPath()})` };
  }
  return { hs: null, reason: 'daemon did not come up within 60 s' };
}

// ---------------------------------------------------------------------------
// cold fallback
function binOf(pkgRel) {
  try {
    return createRequire(path.join(root, 'package.json')).resolve(pkgRel);
  } catch {
    return null;
  }
}

function run(cmd, cmdArgs, opts = {}) {
  const t0 = performance.now();
  const r = spawnSync(cmd, cmdArgs, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: opts.shell || false,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', ms: Math.round(performance.now() - t0) };
}

function runNode(script, scriptArgs, fallbackNpx) {
  if (script) return run(process.execPath, [script, ...scriptArgs]);
  return run('npx', fallbackNpx, { shell: true });
}

function changedFilesForCold() {
  let rels;
  if (sameDirectory(root, baseRoot)) rels = dirtyAgainstHead(root);
  else rels = computeOverlay({ baseRoot, root }).files.filter((f) => f.status !== 'deleted').map((f) => f.path);
  if (args.files && args.files.length) rels = args.files.map((f) => toPosix(path.resolve(root, f))).map((p) => path.posix.relative(root, p));
  return rels.filter((p) => fs.existsSync(path.join(root, p)));
}

function coldTsc() {
  const r = runNode(binOf('typescript/bin/tsc'), ['--noEmit', '-p', 'tsconfig.json'], ['tsc', '--noEmit', '-p', 'tsconfig.json']);
  const errors = [];
  const re = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/gm;
  let m;
  const out = r.stdout + '\n' + r.stderr;
  while ((m = re.exec(out))) {
    errors.push({ file: m[1].replace(/\\/g, '/'), line: Number(m[2]), col: Number(m[3]), code: Number(m[4].slice(2)), message: m[5] });
  }
  return { ok: r.status === 0, errors, introduced: [], resolved: [], baseErrors: null, ms: r.ms, cold: true };
}

function coldEslint(files) {
  const targets = files.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) && f.startsWith('src/'));
  if (!targets.length && files.length) return { ok: true, files: 0, errors: 0, warnings: 0, ms: 0, cold: true, skipped: 'no lintable files' };
  const list = targets.length ? targets : ['src/'];
  const r = runNode(
    binOf('eslint/bin/eslint.js'),
    ['--cache', '--cache-location', '.eslintcache', '--format', 'json', ...list],
    ['eslint', '--cache', '--cache-location', '.eslintcache', '--format', 'json', ...list],
  );
  let errors = 0;
  let warnings = 0;
  const messages = [];
  try {
    for (const f of JSON.parse(r.stdout)) {
      errors += f.errorCount;
      warnings += f.warningCount;
      for (const msg of f.messages) {
        if (msg.severity === 2) messages.push({ file: path.relative(root, f.filePath).replace(/\\/g, '/'), line: msg.line, col: msg.column, code: msg.ruleId, message: msg.message });
      }
    }
  } catch {
    if (r.status !== 0) messages.push({ file: '', line: 0, col: 0, code: 'eslint', message: (r.stderr || r.stdout).trim().slice(0, 2000) });
  }
  return { ok: r.status === 0, files: list.length, errors, warnings, messages, ms: r.ms, cold: true };
}

function coldCensus() {
  const r = run(process.execPath, ['scripts/census/run-census.mjs', '--check']);
  const tail = (r.stdout + r.stderr).trim().split('\n').slice(-30).join('\n');
  return { ok: r.status === 0, ms: r.ms, cold: true, output: tail };
}

function coldVitest(files) {
  if (!files.length) return { ok: true, related: 0, passed: 0, failed: 0, ms: 0, cold: true, skipped: 'no changed files' };
  const r = runNode(binOf('vitest/vitest.mjs'), ['related', ...files, '--run'], ['vitest', 'related', ...files, '--run']);
  const out = r.stdout + r.stderr;
  const passed = Number((/Tests\s+(\d+) passed/.exec(out) || [])[1] || 0);
  const failed = Number((/Tests\s+.*?(\d+) failed/.exec(out) || [])[1] || 0);
  return { ok: r.status === 0, related: files.length, passed, failed, ms: r.ms, cold: true, output: out.trim().split('\n').slice(-20).join('\n') };
}

function runCold(gates, existing) {
  const response = existing || { root, base: { root: baseRoot }, cold: true };
  let files = null;
  for (const g of gates) {
    if (g === 'tsc') response.tsc = coldTsc();
    else if (g === 'eslint') response.eslint = coldEslint((files ??= changedFilesForCold()));
    else if (g === 'census') response.census = coldCensus();
    else if (g === 'vitest') response.vitest = coldVitest((files ??= changedFilesForCold()));
  }
  return response;
}

// ---------------------------------------------------------------------------
// output
function relToRoot(file) {
  if (!file) return '';
  const abs = toPosix(path.isAbsolute(file) ? file : path.join(baseRoot, file));
  const rel = path.posix.relative(root, abs);
  return rel.startsWith('..') ? file : rel;
}

function summarize(name, r) {
  if (!r) return '(not run)';
  if (r.unavailable) return `unavailable: ${r.reason}`;
  switch (name) {
    case 'tsc': {
      const parts = [`${r.errors ? r.errors.length : 0} errors`];
      if (r.baseErrors !== null && r.baseErrors !== undefined) parts.push(`base ${r.baseErrors}`);
      if (r.introduced) parts.push(`introduced ${r.introduced.length}`);
      if (r.resolved) parts.push(`resolved ${r.resolved.length}`);
      if (r.reuse) parts.push(`reuse ${r.reuse}`);
      if (typeof r.filesRechecked === 'number') parts.push(`rechecked ${r.filesRechecked}/${r.totalFiles}`);
      return parts.join(', ');
    }
    case 'eslint':
      return r.skipped ? r.skipped : `${r.files ?? '?'} files, ${r.errors ?? '?'} errors, ${r.warnings ?? '?'} warnings`;
    case 'census': {
      const drift = Array.isArray(r.drift) ? r.drift.length : null;
      const structural = Array.isArray(r.structural) ? r.structural.length : null;
      if (drift === null && structural === null) return r.ok ? 'clean' : 'FAILED';
      return `${drift ?? 0} drifted, ${structural ?? 0} structural`;
    }
    case 'vitest':
      return r.skipped ? r.skipped : `${r.related ?? '?'} related, ${r.passed ?? '?'} passed, ${r.failed ?? '?'} failed`;
    default:
      return r.ok ? 'ok' : 'failed';
  }
}

function printTable(response, gates) {
  const rows = gates.map((g) => {
    const r = response[g];
    const ok = !r ? '-' : r.unavailable ? '?' : r.ok ? 'ok' : 'FAIL';
    return [g, ok, summarize(g, r), r && typeof r.ms === 'number' ? `${r.ms} ms` : '', r && r.cold ? 'cold' : ''];
  });
  const widths = [0, 0, 0, 0, 0];
  for (const row of rows) row.forEach((c, i) => (widths[i] = Math.max(widths[i], c.length)));
  const line = (row) => row.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  const head = response.cold ? `gate (cold) root=${root}` : `gate root=${root} base=${response.base && response.base.head ? response.base.head.slice(0, 9) : '?'}`;
  process.stdout.write(head + '\n');
  if (response.overlay) {
    process.stdout.write(`overlay: ${response.overlay.changed} changed, ${response.overlay.untracked} added, ${response.overlay.deleted} deleted\n`);
  }
  for (const row of rows) process.stdout.write(line(row) + '\n');

  const MAX_LINES = 200;
  for (const g of gates) {
    const r = response[g];
    if (!r || r.unavailable) continue;
    let lines = [];
    if (g === 'tsc') {
      const list = r.introduced && r.introduced.length ? r.introduced : r.baseErrors === null ? r.errors : [];
      lines = list.map((e) => `  ${relToRoot(e.file)}(${e.line},${e.col}): TS${e.code}: ${e.message.split('\n')[0]}`);
      if (r.resolved && r.resolved.length) lines.push(`  (${r.resolved.length} base error(s) resolved by this root)`);
    } else if (g === 'eslint' && Array.isArray(r.messages)) {
      lines = r.messages.map((e) => `  ${relToRoot(e.file)}(${e.line},${e.col}): ${e.code}: ${e.message}`);
    } else if (g === 'census') {
      if (Array.isArray(r.drift)) lines = r.drift.map((d) => `  ${d.rule}: files ${JSON.stringify(d.files)} matches ${JSON.stringify(d.matches)}`);
      if (Array.isArray(r.structural)) lines.push(...r.structural.map((s) => `  ${typeof s === 'string' ? s : JSON.stringify(s)}`));
      if (!lines.length && !r.ok && r.output) lines = r.output.split('\n').map((l) => '  ' + l);
    } else if (g === 'vitest' && !r.ok && r.output) {
      lines = r.output.split('\n').map((l) => '  ' + l);
    }
    if (lines.length) {
      process.stdout.write(`${g}:\n`);
      for (const l of lines.slice(0, MAX_LINES)) process.stdout.write(l + '\n');
      if (lines.length > MAX_LINES) process.stdout.write(`  ... and ${lines.length - MAX_LINES} more\n`);
    }
  }
}

function exitCodeFor(response, gates) {
  for (const g of gates) {
    const r = response[g];
    if (r && !r.unavailable && r.ok === false) return 1;
  }
  return 0;
}

function finish(response, gates) {
  if (args.json) process.stdout.write(JSON.stringify(response, null, 2) + '\n');
  else printTable(response, gates);
  process.exit(exitCodeFor(response, gates));
}

function coldNotice(reason) {
  process.stderr.write(`gate: daemon unavailable (${reason}), running cold\n`);
}

// ---------------------------------------------------------------------------
// main
async function main() {
  if (args.status) {
    const hs = readHandshake();
    if (!hs) {
      process.stdout.write(`no handshake at ${handshakePath()}\n`);
      process.exit(1);
    }
    try {
      const st = await call(hs, 'GET', args.deep ? '/status?deep=1' : '/status', null, args.deep ? args.timeout : 5000);
      process.stdout.write(JSON.stringify(st, null, 2) + '\n');
    } catch (e) {
      process.stdout.write(`daemon pid ${hs.pid} port ${hs.port}: unreachable (${e.message}); alive=${pidAlive(hs.pid)}\n`);
      process.exit(1);
    }
    return;
  }
  if (args.stop) {
    const hs = readHandshake();
    if (!hs) {
      process.stdout.write('no daemon handshake; nothing to stop\n');
      return;
    }
    await stopDaemon(hs);
    process.stdout.write(`stopped daemon pid ${hs.pid}\n`);
    return;
  }
  if (args.cold) {
    finish(runCold(args.gates), args.gates);
    return;
  }

  const { hs, reason } = await ensureDaemon();
  if (!hs) {
    coldNotice(reason);
    finish(runCold(args.gates), args.gates);
    return;
  }
  let response;
  try {
    response = await call(hs, 'POST', '/gate', { root, gates: args.gates, files: args.files }, args.timeout);
  } catch (e) {
    coldNotice(e.message || String(e));
    finish(runCold(args.gates), args.gates);
    return;
  }
  const missing = args.gates.filter((g) => !response[g] || response[g].unavailable);
  if (missing.length) {
    process.stderr.write(`gate: ${missing.map((g) => `${g} (${(response[g] && response[g].reason) || 'no result'})`).join(', ')} unavailable in daemon, running cold\n`);
    runCold(missing, response);
  }
  finish(response, args.gates);
}

main().catch((e) => {
  process.stderr.write(`gate: ${(e && e.stack) || e}\n`);
  process.exit(2);
});
