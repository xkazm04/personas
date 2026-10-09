// The project's own gates, resolved from its brief / manifest / package.json and run inside a
// worktree (WP2). A gate with no command is SKIPPED, reported as such, and never counts as a pass.
// Never runs anything in the project checkout; never edits a file.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ENV_STRIP, SELF_REPO, repoOf } from './contract.mjs';

export const GATE_NAMES = ['typecheck', 'lint', 'test'];
export const GATE_TIMEOUT_MS = 15 * 60 * 1000;
/** The full gate (`verify`): every suite, run before a push or release, so it gets room a busy machine needs. */
export const FULL_GATE_TIMEOUT_MS = 45 * 60 * 1000;
/** A branch that changes more code files than this is not narrowed: its merge gate runs the full suite. */
export const FOCUS_MAX_FILES = 150;
const CODE_EXT = /\.(?:[cm]?[jt]sx?|vue|svelte)$/i;
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

/**
 * The gates of the repo a run targets. The project's own repo: resolveGates(root, brief) as always.
 * A second repo: the brief's `repos[].gates` for that key, else that repo's manifest / package.json.
 * The project brief's own `gates` never apply to another repo (pof's typecheck is not the registry's).
 */
export function resolveRunGates(run, brief = {}) {
  const r = repoOf(run);
  if (r.key === SELF_REPO) return resolveGates(r.root, brief);
  const entry = (Array.isArray(brief?.repos) ? brief.repos : []).find((x) => x?.key === r.key);
  return resolveGates(r.root, entry?.gates && typeof entry.gates === 'object' ? { gates: entry.gates } : {});
}

// ---------------------------------------------------------------- the focused merge gate
//
// Two gates (operator, 2026-10-09). The MERGE gate narrows `test` to the branch's changed area; the
// FULL gate (`verify`) runs every suite before a push or release. Why: under a loaded machine ascent's and
// devsecops' full suites outran the 15-minute gate and held three runs overnight on a timeout, not on a
// failing test. Accepted risk, the operator's: a change can break an unrelated feature and still merge;
// the full gate catches it before anything leaves the machine.

/** The script behind `npm run <name>` in `root`'s package.json, or null. */
function npmScriptOf(root, command) {
  const m = /^npm run ([\w:.-]+)$/.exec(String(command || '').trim());
  return m ? (packageScripts(root)[m[1]] ?? null) : null;
}

/**
 * (root, gates, gateBrief) => {kind:'template', template} | {kind:'vitest'} | null
 * How the merge gate narrows `test`, or null to run the full test command as before.
 * - gateBrief.gates.testFocused, a command with a `{files}` placeholder, wins; an explicit empty
 *   `testFocused` opts the repo out.
 * - Else a test gate that is plain `vitest run` (directly or through `npm run <script>`) becomes
 *   `vitest related`, which runs the tests whose import graph reaches a changed file.
 * - Anything else (kp's node:test runner, firetv's rule suites, a Rust or Gradle gate) stays full.
 * APPMASTER_GATE_FOCUS=off turns narrowing off everywhere.
 */
export function testFocus(root, gates, gateBrief = {}) {
  if (String(process.env.APPMASTER_GATE_FOCUS || '').toLowerCase() === 'off') return null;
  const bg = (gateBrief && typeof gateBrief.gates === 'object' && gateBrief.gates) || {};
  if (Object.prototype.hasOwnProperty.call(bg, 'testFocused')) {
    const tpl = bg.testFocused;
    return typeof tpl === 'string' && tpl.includes('{files}') ? { kind: 'template', template: tpl } : null;
  }
  const cmd = String(gates?.test || '').trim();
  if (!cmd) return null;
  const script = npmScriptOf(root, cmd) ?? cmd.replace(/^npx\s+/, '');
  return /^vitest run\s*$/.test(String(script).trim()) ? { kind: 'vitest' } : null;
}

/** The focus for the repo a run targets: the brief's own gates for self, that repo's entry otherwise (as resolveRunGates). */
export function runTestFocus(run, gates, brief = {}) {
  const r = repoOf(run);
  if (r.key === SELF_REPO) return testFocus(r.root, gates, brief);
  const entry = (Array.isArray(brief?.repos) ? brief.repos : []).find((x) => x?.key === r.key);
  return testFocus(r.root, gates, entry?.gates && typeof entry.gates === 'object' ? { gates: entry.gates } : {});
}

/**
 * (focus, dir, files) => string | '' | null
 * The narrowed test command for `files` (repo-relative, the branch's diff) as they exist in `dir`.
 * '' = no code file changed, so no test can be related: the test gate passes as 'no related tests'.
 * null = too many code files to narrow: run the full test command.
 */
export function focusedTestCommand(focus, dir, files) {
  const code = [...new Set((files || []).map((f) => String(f).replace(/\\/g, '/')))]
    .filter((f) => CODE_EXT.test(f) && fs.existsSync(path.join(dir, f)));
  if (!code.length) return '';
  if (code.length > FOCUS_MAX_FILES) return null;
  const quoted = code.map((f) => `"${f}"`).join(' ');
  return focus.kind === 'template'
    ? focus.template.split('{files}').join(quoted)
    : `npx vitest related --run --passWithNoTests ${quoted}`;
}

const tail = (text, n = TAIL_LINES) => String(text || '').replace(/\s+$/, '').split(/\r?\n/).slice(-n).join('\n');

// A gate is the project's own command in its own worktree, so a repo-local script (`gradlew.bat`) must
// resolve the way it does in the operator's shell. The harness sets NoDefaultCurrentDirectoryInExePath,
// which stops cmd searching the current directory (2026-10-07: firetv's deathride gate failed with
// "'gradlew.bat' is not recognized" in a worktree that held the file).
const GATE_ENV_STRIP = ['NoDefaultCurrentDirectoryInExePath'];

export function gateEnv(extra = {}) {
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  const strip = new Set([...ENV_STRIP, ...GATE_ENV_STRIP].map((k) => k.toUpperCase()));
  for (const k of Object.keys(env)) if (strip.has(k.toUpperCase())) delete env[k];
  return { ...env, ...extra };
}

/**
 * What a failed gate failed ON, so settle can tell "this branch broke it" from "it was already red".
 * A sorted, de-duplicated list of normalised failure lines: vitest/node:test `FAIL`/`x` lines and tsc
 * `error TSnnnn` lines, with timings and (line,col) stripped so a shifted line is not a new failure.
 * Empty when nothing recognisable was printed; the caller then treats the failure as the branch's own.
 */
export function failureSignature(text, cap = 300) {
  const set = new Set();
  const ESC = String.fromCharCode(27);
  const ansi = new RegExp(ESC + '\\[[0-9;]*m', 'g');
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(ansi, '').trim();
    const isTestFail = /^(?:FAIL|\u00d7|\u2717|\u2716|\u2718)\s+/.test(line);
    const isTsError = /error TS\d+/.test(line);
    // node:test summaries as kp's runner prints them: a bare test-file path, and `\u00b7 test name` under it
    const isNodeTestFile = /^(?:[A-Za-z]:)?[\\/].*\.test\.[cm]?[jt]sx?$/.test(line);
    const isNodeTestName = /^\u00b7\s+\S/.test(line);
    // Rust's libtest (`test path::name ... FAILED`), and the census ratchet's drift / structural lines,
    // which carry the rule's counts, so an identical line on the base means master's own red
    // (2026-10-07: personas-web's landing was held on census rises its branch did not add)
    const isRustTestFail = /^test \S+ \.\.\. FAILED$/.test(line);
    const isCensus = /^\[(?:drift|structural)\]\s/.test(line);
    if (!isTestFail && !isTsError && !isNodeTestFile && !isNodeTestName && !isRustTestFail && !isCensus) continue;
    const norm = line
      // the SAME test lives at a different absolute path in the branch worktree and in the base worktree
      .replace(/[A-Za-z]:[\\/][^\s]*?[\\/]worktrees[\\/][^\\/\s]+[\\/][^\\/\s]+[\\/]/g, '')
      .replace(/\\/g, '/')
      .replace(/\(\d+,\d+\)/g, '')              // tsc (line,col)
      // Playwright's list reporter numbers each test by run order ("✘ 843 [node] › ..."), and the
      // number differs between the branch and the base run of the SAME failure (2026-10-07: gravitone's
      // inherited kit-census failures read as the branch's own, so the run was held)
      .replace(/^([×✗✖✘])\s+\d+\s+/, '$1 ')
      .replace(/\s*\(\d+(?:\.\d+)?\s?m?s\)$/i, '')  // trailing (303ms)
      .replace(/\s+\d+(?:\.\d+)?\s?m?s$/i, '')    // trailing timing
      .replace(/\s*\[[^\]]*\]\s*$/, '')           // trailing [ ... ] annotation
      .replace(/\s+/g, ' ')
      .slice(0, 300);
    if (norm) set.add(norm);
  }
  return [...set].sort().slice(0, cap);
}

/** The test files named by failure signature lines (vitest FAIL lines, node:test file lines). */
export function testFilesIn(failures) {
  const files = new Set();
  for (const f of failures || []) {
    // node:test / vitest files (x.test.ts) and Playwright specs (x.spec.ts, printed as "x.spec.ts:15:5 ›")
    const m = /([\w@./-]+\.(?:test|spec)\.[cm]?[jt]sx?)/.exec(String(f));
    if (m) files.add(m[1]);
  }
  return [...files];
}

/** The gate command narrowed to specific files: everything before the first " -- " plus "-- <files>". */
export function narrowCommand(command, files) {
  return String(command).split(' -- ')[0] + ' -- ' + files.join(' ');
}

/** Is every failure of `branch` also a failure of `base`? Both must be non-empty lists. */
export function failuresAreInherited(branch, base) {
  if (!branch?.length || !base?.length) return false;
  const b = new Set(base);
  return branch.every((f) => b.has(f));
}

/** Run one shell command in cwd: cmd /d /s /c on Windows (UTF-8 code page), sh -c elsewhere. `env` adds to the scrubbed env. */
export function runShell(command, cwd, timeoutMs = GATE_TIMEOUT_MS, env = {}) {
  const opts = { cwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 256 * 2 ** 20, stdio: ['ignore', 'pipe', 'pipe'], env: gateEnv(env) };
  const r = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"chcp 65001 >nul & ${command}"`], { ...opts, windowsVerbatimArguments: true })
    : spawnSync('/bin/sh', ['-c', command], opts);
  const timedOut = r.error?.code === 'ETIMEDOUT';
  const text = `${r.stdout || ''}${r.stderr ? `\n${r.stderr}` : ''}${r.error && !timedOut ? `\n${r.error.message}` : ''}${timedOut ? `\n[gate timed out after ${Math.round(timeoutMs / 60000)} min]` : ''}`;
  const ok = r.status === 0 && !timedOut;
  return { ok, exit: r.status, tail: tail(text), ...(ok ? {} : { failures: failureSignature(text) }), ...(timedOut ? { timedOut: true } : {}) };
}

/**
 * (worktree, gates, {timeoutMs}) => {typecheck?:{ok,exit,tail,skipped?},lint?:...,test?:...}
 * Sequential, cwd = the worktree. A gate with no command is {skipped:true, reason:'no command'}.
 */
export function runGates(worktree, gates = {}, { timeoutMs = GATE_TIMEOUT_MS, only, env = {} } = {}) {
  const out = {};
  for (const g of only || GATE_NAMES) {
    const command = gates[g];
    if (!command) { out[g] = { ok: false, skipped: true, reason: 'no command' }; continue; }
    const started = Date.now();
    out[g] = { command, ...runShell(command, worktree, timeoutMs, env), ms: Date.now() - started };
  }
  return out;
}

/** Summarise a runGates result: ran / failed / skipped names and whether it may merge. */
export function gatesVerdict(results) {
  const names = Object.keys(results);
  const skipped = names.filter((g) => results[g].skipped);
  const ran = names.filter((g) => !results[g].skipped);
  const failed = ran.filter((g) => !results[g].ok && !results[g].inherited);
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
