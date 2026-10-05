// Spawn, watch and release builders (WP2). A builder is ONE background headless `claude -p` in its
// own worktree; this file owns the planned -> running -> exited transitions and nothing after.
// It must never kill a process unless the operator said so (`release --kill`), never judge a worker
// dead from a state row (only from its pid), never start a real `claude` under test
// (APPMASTER_CLAUDE_BIN), and never open the app DB: a run carries its ProjectCtx snapshot.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  SKILL_DIR, runDir, shortId, nowIso, mintId, claudeBin, Refusal,
  ENV_STRIP, ENV_SET, RUN_LABEL_PREFIX, GLOBAL_CAP, PER_PROJECT_CAP,
  QUIET_MIN, TIMEOUT_MIN, LIVE_RUN_STATES,
} from './contract.mjs';
import { loadBrief, listRuns, listSlugs, findRun, updateRun } from './store.mjs';
import { readLimit, setLimit, detectLimit, limitSurface, limitSnippet } from './limits.mjs';
import { createWorktree, removeWorktree } from './worktree.mjs';
import { memoryState } from './memory.mjs';
import { resolveGates, splitBoundaries, GATE_NAMES } from './gate.mjs';

// ---------------------------------------------------------------- small helpers

export const runFile = (run, name) => path.join(runDir(run.slug, run.runId), name);
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
/** {stream, stderr} text of a run's captured output. */
export const readRunOutput = (run) => ({ stream: readText(runFile(run, 'stream.jsonl')), stderr: readText(runFile(run, 'stderr.log')) });

/** process.kill(pid, 0): true while the process exists (EPERM also means it exists). */
export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Builders in state `running` across every managed project, not counting `exceptRunId`. */
export function countRunning(exceptRunId) {
  return [...new Set(listSlugs())].flatMap((s) => listRuns(s, { states: ['running'] })).filter((r) => r.runId !== exceptRunId).length;
}
/** Resolve --run (full id or 8-char short form) across every managed project. */
export function requireRun(id) {
  if (!id || id === true) throw new Error('--run <runId> is required');
  const run = findRun(String(id));
  if (!run) throw new Error(`no run ${id} in any managed project`);
  return run;
}

/** The child env: process.env minus ENV_STRIP (case-insensitive), plus ENV_SET and the run label. */
export function workerEnv(slug) {
  const env = { ...process.env };
  const strip = new Set(ENV_STRIP.map((k) => k.toUpperCase()));
  for (const k of Object.keys(env)) if (strip.has(k.toUpperCase())) delete env[k];
  return { ...env, ...ENV_SET, PERSONAS_RUN_LABEL: RUN_LABEL_PREFIX + slug };
}

/** If the run's output carries a limit banner and no mark stands for it yet, write the mark. */
export function markLimitFromRun(run) {
  const { stream, stderr } = readRunOutput(run);
  const surface = limitSurface(stream, stderr);
  if (!detectLimit(surface)) return null;
  const current = readLimit();
  if (current && current.runId === run.runId) return current;
  return setLimit(`worker ${shortId(run.runId)} (${run.slug}) hit a usage limit: ${limitSnippet(surface)}`, null, { runId: run.runId, source: 'worker' });
}

// ---------------------------------------------------------------- prompt

const listOrNone = (items, none) => (items.length ? items.map((s) => `  - ${s}`).join('\n') : `  - ${none}`);

/**
 * (run, brief, gates) => string   // roles/builder.md with every {{placeholder}} filled.
 * A placeholder with no value (undefined/null) or one the template names but this map lacks is an error.
 */
export function renderBuilderPrompt(run, brief = {}, gates = {}) {
  const template = fs.readFileSync(path.join(SKILL_DIR, 'roles', 'builder.md'), 'utf8');
  const { globs, rules } = splitBoundaries(brief?.boundaries);
  const askFor = Array.isArray(brief?.askFor) ? brief.askFor : brief?.askFor ? [brief.askFor] : [];
  const extraRules = Array.isArray(brief?.rules) ? brief.rules : brief?.rules ? [brief.rules] : [];
  const ruleLines = [
    ...rules, ...extraRules,
    ...(askFor.length ? [`Stop and report blocked (with the question) instead of deciding it yourself when the task needs: ${askFor.join('; ')}`] : []),
  ];
  const p = run.project || {};
  const values = {
    project: p.name && p.name !== p.slug ? `${p.name} (${p.slug})` : p.slug,
    root: p.root,
    charter: run.charterSlug,
    reason: run.reason,
    task: run.brief,
    ideaIds: Array.isArray(run.ideaIds) ? (run.ideaIds.length ? run.ideaIds.join(', ') : '(none)') : undefined,
    worktree: run.worktree,
    branch: run.branch,
    baseBranch: p.baseBranch,
    boundaries: listOrNone(globs.map((g) => `\`${g}\``), '(no path boundaries declared)'),
    gates: GATE_NAMES.map((g) => (gates[g] ? `- ${g}: \`${gates[g]}\`` : `- ${g}: no command configured (skipped; not a pass)`)).join('\n'),
    runDir: runDir(run.slug, run.runId),
    rules: listOrNone(ruleLines, '(none beyond this brief)'),
  };
  const missing = Object.entries(values).filter(([, v]) => v === undefined || v === null || v === '').map(([k]) => k);
  if (missing.length) throw new Error(`builder prompt: no value for ${missing.map((k) => `{{${k}}}`).join(', ')}`);
  const unknown = [...new Set([...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).filter((k) => !(k in values)))];
  if (unknown.length) throw new Error(`builder prompt: template names unknown placeholders ${unknown.join(', ')}`);
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k]));
}

// ---------------------------------------------------------------- spawn

/**
 * (run: Run, promptText: string) => {pid, sessionId}
 * Detached, hidden, prompt on STDIN (the Windows argv limit), stdout -> stream.jsonl,
 * stderr -> stderr.log, pid -> pid. APPMASTER_CLAUDE_BIN ending in .js/.mjs/.cjs runs under node.
 */
export function spawnWorker(run, promptText) {
  if (!run.worktree || !fs.existsSync(run.worktree)) throw new Error(`run ${shortId(run.runId)} has no worktree to run in`);
  const dir = runDir(run.slug, run.runId);
  fs.mkdirSync(dir, { recursive: true });
  const sessionId = run.sessionId || mintId();
  const bin = claudeBin();
  const args = ['-p', '-', '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions',
    '--model', run.model, '--session-id', sessionId];
  const [cmd, argv] = /\.(m?js|cjs)$/i.test(bin) ? [process.execPath, [bin, ...args]] : [bin, args];
  const out = fs.openSync(path.join(dir, 'stream.jsonl'), 'a');
  const err = fs.openSync(path.join(dir, 'stderr.log'), 'a');
  let child;
  try {
    child = spawn(cmd, argv, {
      cwd: run.worktree, env: workerEnv(run.slug), detached: true, windowsHide: true,
      stdio: ['pipe', out, err],
    });
  } finally {
    fs.closeSync(out); fs.closeSync(err);
  }
  if (!child.pid) throw new Error(`could not spawn ${cmd}`);
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  child.stdin.end(promptText, 'utf8');
  child.unref();
  fs.writeFileSync(path.join(dir, 'pid'), String(child.pid));
  return { pid: child.pid, sessionId };
}

// ---------------------------------------------------------------- dispatch

/** (args) => Run   // Refusal at limit / memory / not planned / project cap / global cap */
export function cmdDispatch({ flags = {} } = {}) {
  let run = requireRun(flags.run);

  const limit = readLimit();
  if (limit) throw new Refusal('usage limit', { resetsAt: limit.resetsAt ?? null, reason: limit.reason });
  const mem = memoryState({ runningBuilders: countRunning(run.runId) });
  if (!mem.dispatchOk) throw new Refusal('memory', { freeGb: mem.freeGb, needGb: mem.dispatchNeedGb, hint: 'a dispatch needs FREE memory (more with builders already running); `status --text` names who is using it' });
  if (run.state === 'running') return run;
  if (run.state !== 'planned') throw new Refusal('run not planned', { runId: run.runId, state: run.state });
  const mine = listRuns(run.slug, { states: ['running'] }).filter((r) => r.runId !== run.runId);
  if (mine.length >= PER_PROJECT_CAP) throw new Refusal('project cap', { cap: PER_PROJECT_CAP, running: mine.map((r) => shortId(r.runId)) });
  const slugs = [...new Set([...listSlugs(), run.slug])];
  const all = slugs.flatMap((s) => listRuns(s, { states: ['running'] })).filter((r) => r.runId !== run.runId);
  if (all.length >= GLOBAL_CAP) throw new Refusal('global cap', { cap: GLOBAL_CAP, running: all.map((r) => `${r.slug}:${shortId(r.runId)}`) });

  const brief = loadBrief(run.slug) || {};
  const wt = createWorktree(run, brief);
  // the worktree is an effect: record it on the still-planned run before anything else can fail
  run = updateRun(run, { branch: wt.branch, worktree: wt.worktree, baseSha: wt.baseSha, nodeModules: wt.nodeModules });
  const gates = resolveGates(run.project.root, brief);
  const prompt = renderBuilderPrompt(run, brief, gates);
  fs.writeFileSync(runFile(run, 'brief.md'), prompt);
  const { pid, sessionId } = spawnWorker(run, prompt);
  return updateRun(run, { state: 'running', pid, sessionId, startedAt: nowIso() });
}

// ---------------------------------------------------------------- parse / watch

/**
 * (streamText) => {result, isError, costUsd, turns}|null
 * The LAST line whose JSON has type === 'result'. Hook/init noise comes first; a truncated last
 * line is skipped, never parsed.
 */
export function parseResult(streamText) {
  const lines = String(streamText ?? '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o && o.type === 'result') {
      return {
        result: o.result ?? null,
        isError: Boolean(o.is_error ?? o.isError ?? (o.subtype && o.subtype !== 'success')),
        costUsd: o.total_cost_usd ?? o.cost_usd ?? null,
        turns: o.num_turns ?? null,
        ...(o.subtype ? { subtype: o.subtype } : {}),
      };
    }
  }
  return null;
}

const minutesSince = (ms) => +((Date.now() - ms) / 60000).toFixed(1);

/** One watch row for a run; moves running -> exited when its pid is gone. Never kills. */
export function watchRun(run) {
  const alive = pidAlive(run.pid);
  let streamMtime = null;
  try { streamMtime = fs.statSync(runFile(run, 'stream.jsonl')).mtimeMs; } catch { /* no output yet */ }
  const startedMs = run.startedAt ? Date.parse(run.startedAt) : null;
  const streamAgeMin = streamMtime != null ? minutesSince(streamMtime) : null;
  const quietBasis = streamAgeMin ?? (startedMs ? minutesSince(startedMs) : null);
  let current = run;
  if (run.state === 'running' && run.pid && !alive) current = updateRun(run, { state: 'exited', endedAt: nowIso() });
  const row = {
    runId: run.runId, runId8: shortId(run.runId), slug: run.slug, charter: run.charterSlug, state: current.state,
    pidAlive: alive, streamAgeMin,
    quiet: alive && quietBasis != null && quietBasis >= QUIET_MIN,
    timedOut: alive && startedMs != null && minutesSince(startedMs) >= TIMEOUT_MIN,
  };
  if (run.state !== 'planned') {
    const parsed = parseResult(readRunOutput(run).stream);
    if (parsed) row.result = { isError: parsed.isError, costUsd: parsed.costUsd, turns: parsed.turns };
    // mark once per run: an operator who clears the mark is not overruled by the next watch
    if (!current.limitSeenAt && markLimitFromRun(current)) current = updateRun(current, { limitSeenAt: nowIso() });
    if (current.limitSeenAt) row.limitHit = true;
  }
  return row;
}

/** (args) => Array<{runId,runId8,slug,charter,state,pidAlive,streamAgeMin,quiet,timedOut,result?}> */
export function cmdWatch({ flags = {} } = {}) {
  const slugs = flags.project && flags.project !== true ? [String(flags.project)] : listSlugs();
  return slugs.flatMap((s) => listRuns(s, { states: LIVE_RUN_STATES })).map(watchRun);
}

// ---------------------------------------------------------------- release

function killTree(pid) {
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* verified below */ }
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* verified below */ } }
  }
  const until = Date.now() + 5000;
  const nap = new Int32Array(new SharedArrayBuffer(4));
  while (pidAlive(pid) && Date.now() < until) Atomics.wait(nap, 0, 0, 100);
  return !pidAlive(pid);
}

/**
 * (args) => Run   // --run id --reason t [--kill]
 * released + heldReason. The process is terminated ONLY with --kill (the operator said so). The
 * worktree and branch are kept, unless the run never started (planned), whose worktree is removed.
 */
export function cmdRelease({ flags = {} } = {}) {
  const run = requireRun(flags.run);
  if (!flags.reason || flags.reason === true) throw new Error('release needs --reason <text>');
  if (run.state === 'merged') throw new Refusal('run already merged', { runId: run.runId, mergedSha: run.mergedSha });
  if (run.state === 'released') return run;
  const patch = { state: 'released', heldReason: String(flags.reason), endedAt: run.endedAt || nowIso() };
  if (flags.kill && run.pid && pidAlive(run.pid)) {
    if (!killTree(run.pid)) throw new Error(`pid ${run.pid} is still alive after taskkill`);
    patch.killed = true;
  }
  if (run.state === 'planned' && run.worktree) patch.cleanup = removeWorktree(run);
  return updateRun(run, patch);
}
