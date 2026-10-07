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
  QUIET_MIN, TIMEOUT_MIN, LIVE_RUN_STATES, QUEUE_REASONS, SELF_REPO, COUNCIL, normRoot, repoOf, repoEnv, isReviewRun,
} from './contract.mjs';
import { seedCouncil } from './council.mjs';
import { loadBrief, listRuns, listSlugs, findRun, updateRun } from './store.mjs';
import { readLimit, setLimit, detectLimit, limitSurface, limitSnippet } from './limits.mjs';
import { createWorktree, removeWorktree } from './worktree.mjs';
import { memoryState } from './memory.mjs';
import { resolveRunGates, splitBoundaries, GATE_NAMES } from './gate.mjs';
import { overlappingPairs } from './paths.mjs';
import { enqueue, loadQueue, markQueue, positionOf, queuedEntry, withQueueLock } from './queue.mjs';
import { promote } from './promote.mjs';
import { laneFor, runsHoldingRepos } from './repos.mjs';

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
// ---------------------------------------------------------------- the await lock (one await per run)

export const awaitLockPath = (run) => runFile(run, 'await.lock');

/**
 * The live holder of a run's await lock, or null. A lock whose pid is dead or whose expiresAt has
 * passed holds nothing (a crashed await, or a pid the OS reused).
 */
export function awaitHolder(run, now = Date.now()) {
  let held; try { held = JSON.parse(fs.readFileSync(awaitLockPath(run), 'utf8')); } catch { return null; }
  if (!held?.pid || !pidAlive(held.pid)) return null;
  if (held.expiresAt && Date.parse(held.expiresAt) <= now) return null;
  return held;
}

/** Take the run's await lock for this process; false when another live await holds it. */
export function takeAwaitLock(run, expiresAt) {
  const p = awaitLockPath(run);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(p, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: nowIso(), expiresAt }));
      fs.closeSync(fd);
      return true;
    } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const holder = awaitHolder(run);
    if (holder && holder.pid !== process.pid) return false;
    try { fs.rmSync(p, { force: true }); } catch { /* raced */ }   // stale, or our own: retake
  }
  return false;
}

/** Release the lock only if this process holds it. */
export function releaseAwaitLock(run) {
  let held; try { held = JSON.parse(fs.readFileSync(awaitLockPath(run), 'utf8')); } catch { return; }
  if (held?.pid === process.pid) { try { fs.rmSync(awaitLockPath(run), { force: true }); } catch { /* gone */ } }
}

/** Resolve --run (full id or 8-char short form) across every managed project. */
export function requireRun(id) {
  if (!id || id === true) throw new Error('--run <runId> is required');
  const run = findRun(String(id));
  if (!run) throw new Error(`no run ${id} in any managed project`);
  return run;
}

/**
 * The child env: process.env minus ENV_STRIP (case-insensitive), plus ENV_SET, the run label, and what
 * the target repo needs (a run in the Personas repo shares its one CARGO_TARGET_DIR: repoEnv).
 */
export function workerEnv(slug, run = null) {
  const env = { ...process.env };
  const strip = new Set(ENV_STRIP.map((k) => k.toUpperCase()));
  for (const k of Object.keys(env)) if (strip.has(k.toUpperCase())) delete env[k];
  return { ...env, ...ENV_SET, PERSONAS_RUN_LABEL: RUN_LABEL_PREFIX + slug, ...(run ? repoEnv(repoOf(run).root) : {}) };
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
  const target = repoOf(run);
  const env = repoEnv(target.root);
  if (env.CARGO_TARGET_DIR) ruleLines.push(`CARGO_TARGET_DIR is set to the one Personas cargo target (${env.CARGO_TARGET_DIR}); never override it or start a second Rust build tree.`);
  const values = {
    project: p.name && p.name !== p.slug ? `${p.name} (${p.slug})` : p.slug,
    root: target.root,
    repo: target.key === SELF_REPO
      ? 'the project\'s own repo'
      : `\`${target.key}\`, a second repo this project's master works in (base \`${target.baseBranch}\`); the project's own checkout is \`${p.root}\` and is not yours either`,
    charter: run.charterSlug,
    reason: run.reason,
    task: run.brief,
    ideaIds: Array.isArray(run.ideaIds) ? (run.ideaIds.length ? run.ideaIds.join(', ') : '(none)') : undefined,
    worktree: run.worktree,
    branch: run.branch,
    baseBranch: target.baseBranch,
    boundaries: listOrNone(globs.map((g) => `\`${g}\``), '(no path boundaries declared)'),
    gates: GATE_NAMES.map((g) => (gates[g] ? `- ${g}: \`${gates[g]}\`` : `- ${g}: no command configured (skipped; not a pass)`)).join('\n'),
    runDir: runDir(run.slug, run.runId),
    rules: listOrNone(ruleLines, '(none beyond this brief)'),
    paths: Array.isArray(run.paths) && run.paths.length
      ? `${listOrNone(run.paths.map((g) => `\`${g}\``), '')}\n  Another builder may be working beside you on other paths of this repo: stay inside these. A change the task needs outside them is reported in \`questions\`, not made.`
      : '  - (none declared: keep to what the task names)',
  };
  return fillTemplate(template, values, 'builder prompt');
}

/** Every {{placeholder}} filled; a missing value or a placeholder the map lacks is an error, never a blank. */
function fillTemplate(template, values, what) {
  const missing = Object.entries(values).filter(([, v]) => v === undefined || v === null || v === '').map(([k]) => k);
  if (missing.length) throw new Error(`${what}: no value for ${missing.map((k) => `{{${k}}}`).join(', ')}`);
  const unknown = [...new Set([...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).filter((k) => !(k in values)))];
  if (unknown.length) throw new Error(`${what}: template names unknown placeholders ${unknown.join(', ')}`);
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k]));
}

/**
 * (run, brief, seed) => string   // roles/council-reviewer.md filled: a review run runs the council on
 * one feature and writes no code. `seed` is what seedCouncil put in the worktree before it started.
 */
export function renderReviewerPrompt(run, brief = {}, seed = {}) {
  const template = fs.readFileSync(path.join(SKILL_DIR, 'roles', 'council-reviewer.md'), 'utf8');
  const { rules } = splitBoundaries(brief?.boundaries);
  const extraRules = Array.isArray(brief?.rules) ? brief.rules : brief?.rules ? [brief.rules] : [];
  const p = run.project || {};
  const lite = run.councilMode === 'lite';
  const present = seed.present ?? run.councilSeeded ?? [];
  return fillTemplate(template, {
    project: p.name && p.name !== p.slug ? `${p.name} (${p.slug})` : p.slug,
    root: repoOf(run).root,
    charter: run.charterSlug,
    mode: lite ? 'lite' : 'full',
    featureSlug: run.featureSlug,
    reason: run.reason,
    task: run.brief,
    councilCommand: lite ? `/council --lite ${run.featureSlug}` : `/council ${run.featureSlug}`,
    worktree: run.worktree,
    branch: run.branch,
    baseBranch: repoOf(run).baseBranch,
    runsRel: COUNCIL.runsRel,
    seeded: present.length ? present.map((n) => `\`${n}\``).join(', ') : `none (this is the feature's first ${lite ? 'lite' : 'full'} round)`,
    expectedRound: String(seed.expectedRound ?? present.length + 1),
    runDir: runDir(run.slug, run.runId),
    rules: listOrNone([...rules, ...extraRules], '(none beyond this brief)'),
  }, 'reviewer prompt');
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
      cwd: run.worktree, env: workerEnv(run.slug, run), detached: true, windowsHide: true,
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

/**
 * The exit watcher the Director starts (with run_in_background) right after a dispatch. Absolute and
 * forward-slashed so it runs from any cwd in Git Bash and PowerShell alike.
 */
export const awaitCommandFor = (run) => `node "${path.join(SKILL_DIR, 'appmaster.mjs').replace(/\\/g, '/')}" await --run ${shortId(run.runId)}`;

/**
 * (args) => Run & {awaitCommand}   // Refusal at limit / not planned / project cap / paths overlap /
 * global cap / memory. A refusal for a slot (QUEUE_REASONS) is NOT dropped: the planned run is held in
 * the admission queue and the refusal says `queued: true` with its position (still exit 2).
 * Holds the queue lock, so a dispatch and a promote never take the same slot twice.
 */
export function cmdDispatch(args = {}) {
  let run;
  try {
    run = withQueueLock(() => dispatchOrQueue(args), { label: 'dispatch' });
  } catch (e) {
    if (!(e instanceof Refusal) || !e.extra?.queuedBehind) throw e;
    // it queued behind runs already waiting for a machine-wide slot: serve the queue in order now
    // (a slot may be free: a builder exited and its await has not settled yet), this run included
    const p = promote();
    const me = findRun(e.extra.runId);
    const others = (p.awaitCommands ?? []).filter((a) => a.runId !== e.extra.runId);
    if (me?.state === 'running') return { ...me, awaitCommand: awaitCommandFor(me), promotedFirst: others.map((a) => a.runId), awaitCommands: others };
    throw new Refusal(e.reason, { ...e.extra, position: positionOf(e.extra.runId), promoted: p.promoted, awaitCommands: others });
  }
  return { ...run, awaitCommand: awaitCommandFor(run) };
}

/** Refusals that bind every run on the machine: a fresh dispatch never takes such a slot ahead of a waiter. */
const MACHINE_WIDE = ['global cap', 'memory'];

function dispatchOrQueue(args) {
  // FIFO across the machine (the queue's promise): a run dispatched by hand while others already wait
  // for a machine-wide slot joins the queue behind them instead of taking the slot a settling await
  // would have promoted the head into. Measured 2026-10-07: firetv's dispatch took the slot pof's
  // exited builder freed, ahead of garden-vr's two queued runs.
  const asked = requireRun(args.flags?.run);
  if (asked.state === 'planned' && !queuedEntry(asked.runId)) {
    const ahead = loadQueue().filter((e) => e.state === 'queued' && e.runId !== asked.runId && MACHINE_WIDE.includes(e.reason));
    if (ahead.length) {
      const q = enqueue(asked, 'global cap');
      throw new Refusal('global cap', {
        runId: asked.runId, slug: asked.slug, queued: true, queuedBehind: ahead.length, position: q.position, queueLength: q.length,
        hint: 'runs already waiting for a machine-wide slot go first; the promote that follows serves the queue in order',
      });
    }
  }
  let run;
  try {
    run = dispatchCore(args);
  } catch (e) {
    if (!(e instanceof Refusal) || !QUEUE_REASONS.includes(e.reason)) throw e;
    const planned = requireRun(args.flags?.run);
    if (planned.state !== 'planned') throw e;
    const q = enqueue(planned, e.reason);
    throw new Refusal(e.reason, { ...e.extra, runId: planned.runId, slug: planned.slug, queued: true, position: q.position, queueLength: q.length });
  }
  // a queued run the Director dispatched by hand has left the queue
  if (queuedEntry(run.runId)) markQueue(run.runId, 'promoted', { promotedAt: nowIso(), by: 'dispatch' });
  return run;
}

/**
 * The dispatch itself, checks cheapest first so a refusal names the binding constraint and a promote
 * pass over the queue samples memory only for a run that fits everything else. Caller holds the
 * queue lock (cmdDispatch, promote).
 */
export function dispatchCore({ flags = {} } = {}) {
  let run = requireRun(flags.run);

  const limit = readLimit();
  if (limit) throw new Refusal('usage limit', { resetsAt: limit.resetsAt ?? null, reason: limit.reason });
  if (run.state === 'running') return run;
  if (run.state !== 'planned') throw new Refusal('run not planned', { runId: run.runId, state: run.state });
  const mine = listRuns(run.slug, { states: ['running'] }).filter((r) => r.runId !== run.runId);
  if (mine.length >= PER_PROJECT_CAP) throw new Refusal('project cap', { cap: PER_PROJECT_CAP, running: mine.map((r) => shortId(r.runId)) });
  // Everything that holds the run's TARGET repo, in EVERY project (two projects writing one repo must
  // not collide): running, exited, verifying (they still own their files until they merge), and a
  // planned run once it has a worktree (a dispatch that crashed after the spawn may have a live
  // builder). A never-started one has touched nothing, and whichever of two is dispatched second is
  // checked against the first, so skipping it loses no safety and a queued planned run cannot jam it.
  const target = repoOf(run);
  const holding = runsHoldingRepos(run.runId, [run.slug]).filter((r) => normRoot(repoOf(r).root) === normRoot(target.root));
  const lane = laneFor(target.root);
  if (lane != null && holding.length >= lane) {
    throw new Refusal('repo lane', {
      runId: run.runId, repo: target.key, root: target.root, lane,
      holding: holding.map((r) => `${r.slug}:${shortId(r.runId)} (${r.state})`),
      hint: `at most ${lane} live run(s) may target this repo across all projects`,
    });
  }
  // Disjoint declared paths in that repo. No declared paths = the whole repo. A council review commits
  // nothing (settle holds one that does), so it neither blocks a builder nor is blocked by one.
  const clashes = (isReviewRun(run) ? [] : holding.filter((r) => !isReviewRun(r)))
    .map((r) => ({ runId8: shortId(r.runId), slug: r.slug, state: r.state, charter: r.charterSlug, paths: r.paths ?? [], pairs: overlappingPairs(run.paths, r.paths) }))
    .filter((c) => c.pairs.length);
  if (clashes.length) {
    throw new Refusal('paths overlap', {
      runId: run.runId, paths: run.paths ?? [], repo: target.key,
      with: clashes.map((c) => ({ runId8: c.runId8, slug: c.slug, state: c.state, charter: c.charter, paths: c.paths, overlaps: c.pairs.slice(0, 6) })),
      hint: 'a run with no declared paths covers the whole repo; dispatch this after the other run settles',
    });
  }
  const slugs = [...new Set([...listSlugs(), run.slug])];
  const all = slugs.flatMap((s) => listRuns(s, { states: ['running'] })).filter((r) => r.runId !== run.runId);
  if (all.length >= GLOBAL_CAP) throw new Refusal('global cap', { cap: GLOBAL_CAP, running: all.map((r) => `${r.slug}:${shortId(r.runId)}`) });
  const mem = memoryState({ runningBuilders: all.length });
  if (!mem.dispatchOk) throw new Refusal('memory', { freeGb: mem.freeGb, needGb: mem.dispatchNeedGb, hint: 'a dispatch needs FREE memory (more with builders already running); `status --text` names who is using it' });

  const brief = loadBrief(run.slug) || {};
  const wt = createWorktree(run, brief);
  // the worktree is an effect: record it on the still-planned run before anything else can fail
  run = updateRun(run, { branch: wt.branch, worktree: wt.worktree, baseSha: wt.baseSha, nodeModules: wt.nodeModules });
  let prompt;
  if (isReviewRun(run)) {
    // the feature's earlier rounds and the last human decision go in first; what is there now is
    // recorded, so settle never takes a pre-existing run directory for this review's
    const seed = seedCouncil(run, repoOf(run).root);
    run = updateRun(run, { councilSeeded: seed.present, councilSeed: { copied: seed.copied, stateCopied: seed.stateCopied, expectedRound: seed.expectedRound } });
    prompt = renderReviewerPrompt(run, brief, seed);
  } else {
    prompt = renderBuilderPrompt(run, brief, resolveRunGates(run, brief));
  }
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
  if (run.state === 'reviewed') throw new Refusal('run already reviewed', { runId: run.runId, outcome: run.council?.outcome ?? null });
  if (run.state === 'released') return run;
  const patch = { state: 'released', heldReason: String(flags.reason), endedAt: run.endedAt || nowIso() };
  if (flags.kill && run.pid && pidAlive(run.pid)) {
    if (!killTree(run.pid)) throw new Error(`pid ${run.pid} is still alive after taskkill`);
    patch.killed = true;
  }
  if (run.state === 'planned' && run.worktree) patch.cleanup = removeWorktree(run);
  const out = updateRun(run, patch);
  // a released run owes the queue nothing more: its promise ends in this explicit refusal
  if (queuedEntry(run.runId)) markQueue(run.runId, 'dropped', { droppedAt: nowIso(), droppedReason: String(flags.reason) });
  return out;
}
