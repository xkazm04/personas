// Verify a builder's claim, then the rung-3 merge gate (WP2). Owns verifying -> merged | held |
// failed | released. The builder's result.json is a CLAIM and is never trusted: commits come from
// git, the verdict from the project's own gates run in the worktree.
// In the project checkout this file only ever runs read-only git plus ONE `merge --ff-only`; it
// never stashes, checks out, resets, `add -A`s or cleans there. A held run keeps branch + worktree.

import fs from 'node:fs';
import path from 'node:path';
import { nowIso, readJson, shortId, Refusal } from './contract.mjs';
import { loadBrief, updateRun, raiseAsk, queueOutbox, openAsks, updateAsk } from './store.mjs';
import { readLimit } from './limits.mjs';
import { requireRun, pidAlive, runFile, markLimitFromRun } from './worker.mjs';
import { git, gitTry, revParse, isAncestor, removeWorktree, withBaseWorktree } from './worktree.mjs';
import { acquireGateSlot } from './memory.mjs';
import { resolveGates, runGates, gatesVerdict, splitBoundaries, boundaryHits, failuresAreInherited, GATE_TIMEOUT_MS } from './gate.mjs';

const lines = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const keyOf = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const lastLines = (s, n) => String(s || '').split(/\r?\n/).filter((l) => l.trim()).slice(-n).join(' | ');

// ---------------------------------------------------------------- porcelain

function unquoteC(s) {
  if (!(s.length >= 2 && s.startsWith('"') && s.endsWith('"'))) return s;
  const body = s.slice(1, -1), bytes = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') { bytes.push(...Buffer.from(c, 'utf8')); continue; }
    const n = body[++i];
    if (/[0-7]/.test(n)) { bytes.push(parseInt(body.slice(i, i + 3), 8)); i += 2; }
    else bytes.push(({ n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 })[n] ?? n.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * Paths from `git status --porcelain[=v1] --no-renames`. With `z` the input is NUL-separated and
 * unquoted; without it, C-quoted paths ("a b.txt", octal-escaped UTF-8) are unquoted.
 */
export function parsePorcelain(text, { z = false } = {}) {
  const entries = z ? String(text).split('\0') : String(text).split(/\r?\n/);
  return entries.filter((e) => e.length > 3).map((e) => {
    const p = e.slice(3);
    return z ? p : unquoteC(p);
  });
}

/** Dirty paths of a checkout (tracked changes, staged or not, and every untracked file). */
export function dirtyPaths(root) {
  const out = git(root, ['status', '--porcelain', '--no-renames', '--untracked-files=all', '-z'], { stdio: ['ignore', 'pipe', 'pipe'] });
  return parsePorcelain(out, { z: true });
}

// ---------------------------------------------------------------- held / failed / merged

const HELD_OPTIONS = (branch) => [
  { label: 'Merge it myself', action: `operator merges branch ${branch}` },
  { label: 'Discard the branch', action: 'release run; the branch is kept for the operator to delete' },
  { label: 'Re-dispatch after I commit', action: 'wait for a clean tree' },
];

/**
 * A run that was held, then merged on a retry, leaves its merge-held asks open: nothing closed them
 * (2026-10-05: four stale asks after two merged retries). The hold question starts `Run <id8> `, so
 * close this run's open merge-gate asks, saying why.
 */
export function closeHeldAsks(run, sha) {
  const prefix = `Run ${shortId(run.runId)} `;
  const closed = [];
  for (const a of openAsks(run.slug)) {
    if (a.source !== 'merge-gate' || !String(a.question || '').startsWith(prefix)) continue;
    updateAsk(run.slug, a.askId, { state: 'answered', answer: { choice: '(closed by settle)', notes: `run merged ${String(sha).slice(0, 10)} on a later settle; nothing left to decide`, at: nowIso() } });
    closed.push(a.askId);
  }
  return closed;
}

function hold(run, reason, verdict) {
  const id8 = shortId(run.runId);
  const question = `Run ${id8} (${run.charterSlug}) in ${run.slug} is held and was not merged: ${reason}. What should happen to branch ${run.branch}?`;
  const context = [
    `Task: ${String(run.brief || '').split('\n')[0].slice(0, 200)}`,
    `Branch ${run.branch} (${verdict?.commits?.length ?? 0} commit(s) on top of ${String(run.baseSha || '').slice(0, 10)}), worktree ${run.worktree}.`,
    verdict?.files?.length ? `Files: ${verdict.files.slice(0, 20).join(', ')}${verdict.files.length > 20 ? ' ...' : ''}` : null,
    verdict?.dirtyOverlap?.length ? `Uncommitted in the checkout and touched by the branch: ${verdict.dirtyOverlap.join(', ')}` : null,
    verdict?.boundaryHits?.length ? `Boundary hits: ${verdict.boundaryHits.map((h) => `${h.file} (${h.glob})`).join(', ')}` : null,
  ].filter(Boolean).join('\n');
  const options = HELD_OPTIONS(run.branch);
  const ask = raiseAsk(run.slug, { wakeId: run.wakeId, source: 'merge-gate', kind: 'merge-held', question, context, options });
  queueOutbox(run.slug, run.project.id, 'ask', { askId: ask.askId, question, context, options }, { runId: run.runId });
  return updateRun(run, { state: 'held', heldReason: reason, verdict, askId: ask.askId, settledAt: nowIso() });
}

function worktreeDirty(wt) {
  // the node_modules junction is ours, not the builder's (a repo that forgot to ignore it lists it)
  return dirtyPaths(wt).filter((p) => p !== 'node_modules' && !p.startsWith('node_modules/'));
}

function taskTitle(run) {
  const first = String(run.brief || '').split('\n').map((l) => l.trim()).find(Boolean) || run.charterSlug;
  const t = `${run.charterSlug}: ${first}`;
  return t.length > 120 ? `${t.slice(0, 117)}...` : t;
}

// ---------------------------------------------------------------- merge gate

const IN_PROGRESS = ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'];

/**
 * (run: Run, verdict) => {ok:boolean, reason?:string, sha?:string, dirtyOverlap?:string[], rebased?:boolean}
 * (a) checkout on baseBranch, no merge/rebase/cherry-pick in progress; (b) checkout dirty paths
 * do not intersect the branch's diff; (c) a moved base means a clean worktree rebase + typecheck;
 * (d) `merge --ff-only` and HEAD == branch tip afterwards. Mutates `verdict` with what it measured.
 */
export function mergeGate(run, verdict = {}, { gates, timeoutMs = GATE_TIMEOUT_MS } = {}) {
  const { root, baseBranch } = run.project;
  const branchRef = `refs/heads/${run.branch}`;

  const head = gitTry(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!head.ok || head.out !== baseBranch) return { ok: false, reason: `the checkout is on ${head.out || '(unknown)'}, not ${baseBranch}` };
  for (const marker of IN_PROGRESS) {
    const rel = git(root, ['rev-parse', '--git-path', marker]);
    if (fs.existsSync(path.resolve(root, rel))) return { ok: false, reason: `the checkout has ${marker} (an operation is in progress)` };
  }

  // A stuck `git stash pop` (measured in pof, 2026-10-05) leaves conflicted index entries with no
  // MERGE_HEAD; git then refuses every merge. Say so instead of failing at the last step.
  const unmerged = lines(git(root, ['ls-files', '--unmerged'])).map((l) => l.split('\t')[1]).filter(Boolean);
  if (unmerged.length) {
    const uniq = [...new Set(unmerged)];
    return { ok: false, reason: `the checkout has ${uniq.length} unresolved conflicted file(s) (a stuck stash pop or merge); resolve them first: ${uniq.slice(0, 3).join(', ')}${uniq.length > 3 ? ', ...' : ''}` };
  }

  let baseNow = revParse(root, `refs/heads/${baseBranch}`);
  let rebased = false;
  if (baseNow !== run.baseSha && !isAncestor(root, baseNow, branchRef)) {
    const r = gitTry(run.worktree, ['rebase', baseNow]);
    if (!r.ok) {
      gitTry(run.worktree, ['rebase', '--abort']);
      return { ok: false, reason: `the base moved and rebasing onto ${baseNow.slice(0, 10)} conflicts: ${lastLines(r.err || r.out, 3)}` };
    }
    rebased = true;
    const g = gates || resolveGates(root, loadBrief(run.slug) || {});
    const tc = runGates(run.worktree, g, { timeoutMs, only: ['typecheck'] });
    verdict.gatesAfterRebase = tc;
    if (!tc.typecheck.skipped && !tc.typecheck.ok) {
      return { ok: false, rebased, reason: `typecheck fails after rebasing onto the moved base (exit ${tc.typecheck.exit}): ${lastLines(tc.typecheck.tail, 5)}` };
    }
    verdict.commits = lines(git(root, ['rev-list', '--reverse', `${baseNow}..${branchRef}`]));
  }
  verdict.rebased = rebased;
  verdict.files = lines(git(root, ['diff', '--name-only', '--no-renames', `${baseNow}..${branchRef}`]));

  const dirty = new Set(dirtyPaths(root).map(keyOf));
  const overlap = verdict.files.filter((f) => dirty.has(keyOf(f)));
  verdict.dirtyOverlap = overlap;
  if (overlap.length) return { ok: false, rebased, dirtyOverlap: overlap, reason: `uncommitted changes in the checkout overlap the branch: ${overlap.join(', ')}` };

  const tip = revParse(root, branchRef);
  const m = gitTry(root, ['merge', '--ff-only', branchRef]);
  if (!m.ok) return { ok: false, rebased, reason: `merge --ff-only refused: ${lastLines(m.err || m.out, 3)}` };
  const after = git(root, ['rev-parse', 'HEAD']);
  if (after !== tip) return { ok: false, rebased, reason: `after the merge HEAD is ${after.slice(0, 10)}, not the branch tip ${tip.slice(0, 10)}` };
  return { ok: true, sha: tip, rebased, dirtyOverlap: [] };
}

// ---------------------------------------------------------------- settle

/**
 * (args) => Run   // --run id [--retry]   merged | held(+ask queued) | failed | released
 * A settled run returns as it is; `--retry` re-settles a held one (after the operator cleaned up).
 */
/** Holds the machine-wide gate slot while a settle runs gates; released however the settle ends. */
export function cmdSettle(args = {}) {
  const slot = { release: null, prev: null, runId: null };
  try { return settleCore(args, slot); } finally { slot.release?.(); }
}

function settleCore({ flags = {} } = {}, slot) {
  let run = requireRun(flags.run);
  if (['merged', 'failed', 'released'].includes(run.state)) return run;
  if (run.state === 'held' && !flags.retry) return run;
  if (run.state === 'planned') throw new Refusal('not dispatched', { runId: run.runId });
  if (run.state === 'running') {
    if (pidAlive(run.pid)) throw new Refusal('still running', { runId: run.runId, pid: run.pid });
    run = updateRun(run, { state: 'exited', endedAt: run.endedAt || nowIso() });
  }
  slot.prev = run.state; slot.runId = run.runId;
  run = updateRun(run, { state: 'verifying', verifyStartedAt: nowIso() });

  // A usage limit is not a verdict on the work: release, keep everything, let a later pass retake it.
  const standing = readLimit();
  const mark = run.limitSeenAt ? (standing?.runId === run.runId ? standing : { reason: 'seen by watch' })
    : markLimitFromRun(run) || (standing?.runId === run.runId ? standing : null);
  if (mark) return updateRun(run, { state: 'released', heldReason: `usage limit: ${mark.reason}`, settledAt: nowIso() });

  const { root } = run.project;
  const brief = loadBrief(run.slug) || {};
  const branchRef = `refs/heads/${run.branch}`;
  const verdict = { commits: [], files: [], gates: {}, boundaryHits: [], dirtyOverlap: [] };
  verdict.claim = readJson(runFile(run, 'result.json'), null);

  if (!run.branch || !gitTry(root, ['rev-parse', '--verify', '--quiet', branchRef]).ok) return hold(run, `branch ${run.branch} does not exist`, verdict);

  // 1. the claim, from git
  verdict.commits = lines(git(root, ['rev-list', '--reverse', `${run.baseSha}..${branchRef}`]));
  if (!verdict.commits.length) {
    const left = run.worktree && fs.existsSync(run.worktree) ? worktreeDirty(run.worktree) : [];
    let cleanup = null;
    if (!left.length) { try { cleanup = removeWorktree(run); } catch (e) { cleanup = { error: e.message }; } }
    const reason = left.length ? `builder produced no commits (uncommitted changes left in the worktree: ${left.slice(0, 10).join(', ')})` : 'builder produced no commits';
    return updateRun(run, { state: 'failed', heldReason: reason, verdict, cleanup, settledAt: nowIso() });
  }
  verdict.files = lines(git(root, ['diff', '--name-only', '--no-renames', `${run.baseSha}..${branchRef}`]));
  verdict.boundaryHits = boundaryHits(verdict.files, splitBoundaries(brief.boundaries).globs);
  if (verdict.boundaryHits.length) return hold(run, `the branch touches boundary paths: ${verdict.boundaryHits.map((h) => h.file).join(', ')}`, verdict);

  if (!run.worktree || !fs.existsSync(run.worktree)) return hold(run, `the worktree ${run.worktree} is gone; nothing to run the gates in`, verdict);
  const wtHead = gitTry(run.worktree, ['rev-parse', 'HEAD']).out;
  if (wtHead !== revParse(root, branchRef)) return hold(run, `the worktree HEAD ${wtHead.slice(0, 10)} is not the branch tip`, verdict);
  const left = worktreeDirty(run.worktree);
  if (left.length) return hold(run, `the worktree has uncommitted changes, so the gates would not verify the committed tip: ${left.slice(0, 10).join(', ')}`, verdict);

  // 2. the project's own gates, in the worktree. They are the heavy part (typecheck + tests, then the
  // same again on the base): take the machine-wide gate slot first, and wait (bounded) for headroom.
  // A refusal here puts the run back where it was, so a later settle simply retries.
  try { slot.release = acquireGateSlot({ label: `settle ${shortId(run.runId)}` }); } catch (e) {
    if (e instanceof Refusal) updateRun(run, { state: slot.prev === 'held' ? 'held' : 'exited' });
    throw e;
  }

  // 2b. run them
  const gates = resolveGates(root, brief);
  const timeoutMs = Number(process.env.APPMASTER_GATE_TIMEOUT_MS) || GATE_TIMEOUT_MS;
  verdict.gates = runGates(run.worktree, gates, { timeoutMs });
  verdict.gateSources = gates.sources;
  // A gate that fails on the branch is the BRANCH's failure only if the base does not fail the same
  // way: these repos carry red tests of their own (measured 2026-10-05: a docs-only ascent branch and
  // a test-clock pin in pof were held by tests neither could have touched). Re-run each failed gate
  // once on the base commit; failures that are all inherited are recorded, not blocking.
  for (const g of Object.keys(verdict.gates)) {
    const r = verdict.gates[g];
    if (r.skipped || r.ok || r.timedOut || !r.failures?.length || !run.baseSha) continue;
    try {
      const base = withBaseWorktree(run, (dir) => runGates(dir, gates, { timeoutMs, only: [g] })[g]);
      r.base = { ok: base.ok, exit: base.exit, failures: base.failures?.length ?? 0 };
      if (!base.ok && failuresAreInherited(r.failures, base.failures)) r.inherited = true;
    } catch (e) { r.base = { error: String(e.message || e).split('\n')[0] }; }
  }
  // The gates ran in a worktree that was clean before them, so anything dirty now is THEIR side effect
  // (vitest rewrote snapshot files in both first runs, 2026-10-05). Record it and revert it: a retry,
  // the rebase and the merge gate all need the committed tip, not the tip plus a test run's leftovers.
  const effects = worktreeDirty(run.worktree);
  if (effects.length) {
    verdict.gateSideEffects = effects.slice(0, 20);
    gitTry(run.worktree, ['checkout', '--', '.']);
    gitTry(run.worktree, ['clean', '-fdq', '-e', 'node_modules']);
  }
  const gv = gatesVerdict(verdict.gates);
  if (!gv.ran.length) return hold(run, 'no verifiable gate (every gate was skipped: no command)', verdict);
  if (gv.failed.length) {
    const g = gv.failed[0], r = verdict.gates[g];
    return hold(run, `gate ${g} failed (exit ${r.exit}${r.timedOut ? ', timed out' : ''}): ${lastLines(r.tail, 5)}`, verdict);
  }

  // 3. the merge gate
  const mg = mergeGate(run, verdict, { gates, timeoutMs });
  if (!mg.ok) return hold(run, mg.reason, verdict);

  // queue BEFORE recording merged: the entry is idempotent, and a crash in between leaves a
  // `verifying` run whose re-settle finds the branch already in base and queues the same id again
  queueOutbox(run.slug, run.project.id, 'task-complete',
    { ideaIds: run.ideaIds || [], sha: mg.sha, title: taskTitle(run), runId: run.runId, branch: run.branch }, { runId: run.runId });
  closeHeldAsks(run, mg.sha);
  run = updateRun(run, { state: 'merged', mergedSha: mg.sha, verdict, endedAt: run.endedAt || nowIso(), settledAt: nowIso() });
  let cleanup;
  try { cleanup = removeWorktree(run); } catch (e) { cleanup = { error: e.message }; }
  return updateRun(run, { cleanup });
}
