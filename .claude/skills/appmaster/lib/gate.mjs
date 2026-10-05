// The project's own gates, resolved from its brief / manifest / package.json and run inside a
// worktree (WP2). A gate with no command is SKIPPED, reported as such, and never counts as a pass.
// Never runs anything in the project checkout; never edits a file.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ENV_STRIP } from './contract.mjs';

export const GATE_NAMES = ['typecheck', 'lint', 'test'];
export const GATE_TIMEOUT_MS = 15 * 60 * 1000;
const TAIL_LINES = 40;

/** `.ai/manifest.yaml` capabilities: `  typecheck: { command: "..." }` lines inside `capabilities:`. */
export function manifestCapabilities(root) {
  let text; try { text = fs.readFileSync(path.join(root, '.ai', 'manifest.yaml'), 'utf8'); } catch { return {}; }
  const out = {};
  let inCaps = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^capabilities:\s*(#.*)?$/.test(line)) { inCaps = true; continue; }
    if (inCaps && /^\S/.test(line)) inCaps = false;
    if (!inCaps) continue;
    const m = line.match(/^\s+([A-Za-z0-9_-]+):\s*\{.*?\bcommand:\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/);
    if (m) out[m[1]] = m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3];
  }
  return out;
}

function packageScripts(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts || {}; } catch { return {}; }
}

/**
 * (root, brief) => {typecheck?:string,lint?:string,test?:string}
 * Per gate: brief.gates first, else manifest capabilities, else the package.json script (run as
 * `npm run <name>`), else null. A brief key that is present but empty/null deliberately skips that
 * gate. The returned object also carries a non-enumerable `sources` map (gate -> where it came from).
 */
export function resolveGates(root, brief = {}) {
  const fromBrief = (brief && typeof brief.gates === 'object' && brief.gates) || {};
  const caps = manifestCapabilities(root);
  const scripts = packageScripts(root);
  const gates = {}, sources = {};
  for (const g of GATE_NAMES) {
    if (Object.prototype.hasOwnProperty.call(fromBrief, g)) {
      gates[g] = fromBrief[g] ? String(fromBrief[g]) : null; sources[g] = 'brief';
    } else if (caps[g]) { gates[g] = caps[g]; sources[g] = 'manifest'; }
    else if (scripts[g]) { gates[g] = `npm run ${g}`; sources[g] = 'package.json'; }
    else { gates[g] = null; sources[g] = 'none'; }
  }
  Object.defineProperty(gates, 'sources', { value: sources, enumerable: false });
  return gates;
}

const tail = (text, n = TAIL_LINES) => String(text || '').replace(/\s+$/, '').split(/\r?\n/).slice(-n).join('\n');

function gateEnv() {
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  const strip = new Set(ENV_STRIP.map((k) => k.toUpperCase()));
  for (const k of Object.keys(env)) if (strip.has(k.toUpperCase())) delete env[k];
  return env;
}

/** Run one shell command in cwd: cmd /d /s /c on Windows (UTF-8 code page), sh -c elsewhere. */
export function runShell(command, cwd, timeoutMs = GATE_TIMEOUT_MS) {
  const opts = { cwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 256 * 2 ** 20, stdio: ['ignore', 'pipe', 'pipe'], env: gateEnv() };
  const r = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"chcp 65001 >nul & ${command}"`], { ...opts, windowsVerbatimArguments: true })
    : spawnSync('/bin/sh', ['-c', command], opts);
  const timedOut = r.error?.code === 'ETIMEDOUT';
  const text = `${r.stdout || ''}${r.stderr ? `\n${r.stderr}` : ''}${r.error && !timedOut ? `\n${r.error.message}` : ''}${timedOut ? `\n[gate timed out after ${Math.round(timeoutMs / 60000)} min]` : ''}`;
  return { ok: r.status === 0 && !timedOut, exit: r.status, tail: tail(text), ...(timedOut ? { timedOut: true } : {}) };
}

/**
 * (worktree, gates, {timeoutMs}) => {typecheck?:{ok,exit,tail,skipped?},lint?:...,test?:...}
 * Sequential, cwd = the worktree. A gate with no command is {skipped:true, reason:'no command'}.
 */
export function runGates(worktree, gates = {}, { timeoutMs = GATE_TIMEOUT_MS, only } = {}) {
  const out = {};
  for (const g of only || GATE_NAMES) {
    const command = gates[g];
    if (!command) { out[g] = { ok: false, skipped: true, reason: 'no command' }; continue; }
    const started = Date.now();
    out[g] = { command, ...runShell(command, worktree, timeoutMs), ms: Date.now() - started };
  }
  return out;
}

/** Summarise a runGates result: ran / failed / skipped names and whether it may merge. */
export function gatesVerdict(results) {
  const names = Object.keys(results);
  const skipped = names.filter((g) => results[g].skipped);
  const ran = names.filter((g) => !results[g].skipped);
  const failed = ran.filter((g) => !results[g].ok);
  return { ran, failed, skipped, ok: ran.length > 0 && failed.length === 0 };
}

// ---------------------------------------------------------------- boundaries

/**
 * brief.boundaries mixes two things in the real briefs: path globs (`src-tauri/db/**`) and prose
 * rules (kp: "No new external services or paid APIs ..."). An entry with no whitespace is a path
 * glob and is enforced by settle; anything else is a rule the builder is told, not a matcher.
 */
export const isPathGlob = (s) => typeof s === 'string' && s.trim() !== '' && !/\s/.test(s.trim());
export function splitBoundaries(boundaries) {
  const list = Array.isArray(boundaries) ? boundaries : boundaries ? [boundaries] : [];
  return { globs: list.filter(isPathGlob).map((s) => s.trim()), rules: list.filter((s) => !isPathGlob(s)).map(String) };
}

/** Glob -> RegExp over a repo-relative forward-slash path: `**` any depth, `*` and `?` within a segment. */
export function globToRegex(glob) {
  let g = String(glob).trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
  if (g.endsWith('/')) g += '**';
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      i++;
      if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // a pattern with no glob chars also covers everything below it (a directory name)
  const tailRe = /[*?]/.test(g) ? '' : '(?:/.*)?';
  // a pattern with no slash matches at any depth, like .gitignore
  const lead = g.includes('/') ? '' : '(?:.*/)?';
  return new RegExp(`^${lead}${re}${tailRe}$`, process.platform === 'win32' ? 'i' : '');
}

/** (files, globs) => [{file, glob}] for every file a boundary glob covers. */
export function boundaryHits(files, globs) {
  const res = globs.map((g) => [g, globToRegex(g)]);
  const hits = [];
  for (const f of files) for (const [g, re] of res) if (re.test(f.replace(/\\/g, '/'))) { hits.push({ file: f, glob: g }); break; }
  return hits;
}
