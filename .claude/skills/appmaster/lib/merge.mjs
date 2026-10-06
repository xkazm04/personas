// Verify a builder's claim, then the rung-3 merge gate (WP2). Owns verifying -> merged | held |
// failed | released. The builder's result.json is a CLAIM and is never trusted: commits come from
// git, the verdict from the project's own gates run in the worktree.
// In the project checkout this file only ever runs read-only git plus ONE `merge --ff-only`; it
// never stashes, checks out, resets, `add -A`s or cleans there. A held run keeps branch + worktree.

import fs from 'node:fs';
import path from 'node:path';
import { nowIso, readJson, shortId, Refusal, SELF_REPO, repoOf, repoEnv } from './contract.mjs';
import { loadBrief, updateRun, raiseAsk, queueOutbox, openAsks, updateAsk } from './store.mjs';
import { readLimit } from './limits.mjs';
import { requireRun, pidAlive, runFile, markLimitFromRun, awaitHolder } from './worker.mjs';
import { git, gitTry, revParse, isAncestor, removeWorktree, withBaseWorktree } from './worktree.mjs';
import { acquireGateSlot } from './memory.mjs';
import { resolveRunGates, runGates, gatesVerdict, splitBoundaries, boundaryHits, failuresAreInherited, testFilesIn, narrowCommand, GATE_TIMEOUT_MS } from './gate.mjs';

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
  const target = repoOf(run);
  const where = target.key === SELF_REPO ? run.slug : `${run.slug} (its ${target.key} repo, ${target.root})`;
  const question = `Run ${id8} (${run.charterSlug}) in ${where} is held and was not merged: ${reason}. What should happen to branch ${run.branch}?`;
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

// ---------------------------------------------------------------- a moved base: rebase in the worktree

const IN_PROGRESS = ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'];

/**
 * (run) => {ok, rebased, onto, from?, restored?, reason?}
 * With two builders per project the second to settle finds the base moved (the first merged), and
 * the operator may commit at any time. When the base tip is not an ancestor of the run branch,
 * rebase the branch onto that tip INSIDE the run's worktree (the checkout is never touched). On a
 * conflict the rebase is aborted and the result measured: worktree clean, no rebase in progress,
 * branch tip unchanged. Never forced; a failure is returned for a hold. The worktree must be clean
 * on entry (settle checks it before calling).
 */
export function rebaseOntoBase(run) {
  const { root, baseBranch } = repoOf(run);
  const branchRef = `refs/heads/${run.branch}`;
  const onto = revParse(root, `refs/heads/${baseBranch}`);
  if (isAncestor(root, onto, branchRef)) return { ok: true, rebased: false, onto };
  const tipBefore = revParse(root, branchRef);
  const r = gitTry(run.worktree, ['rebase', onto]);
  if (r.ok) return { ok: true, rebased: true, onto, from: run.baseSha };
  const abort = gitTry(run.worktree, ['rebase', '--abort']);
  const tipAfter = gitTry(root, ['rev-parse', branchRef]).out;
  const inProgress = ['rebase-merge', 'rebase-apply']
    .some((m) => fs.existsSync(path.resolve(run.worktree, git(run.worktree, ['rev-parse', '--git-path', m]))));
  const left = worktreeDirty(run.worktree);
  const restored = abort.ok && tipAfter === tipBefore && !inProgress && !left.length;
  const why = lastLines(r.err || r.out, 3);
  return {
    ok: false, rebased: false, onto, restored,
    reason: restored
      ? `the base moved and rebasing onto ${onto.slice(0, 10)} conflicts (the rebase was aborted; the branch is unchanged): ${why}`
      : `the base moved and rebasing onto ${onto.slice(0, 10)} conflicts, and the abort did NOT restore the worktree (abort ${abort.ok ? 'ok' : 'failed'}, tip ${String(tipAfter).slice(0, 10)} was ${tipBefore.slice(0, 10)}, ${inProgress ? 'a rebase is still in progress' : 'no rebase in progress'}, ${left.length} dirty path(s)): ${why}`,
  };
}

// ---------------------------------------------------------------- the project's gates, with settle's reprieves

/**
 * (run, gates, {timeoutMs}) => {results, sideEffects}
 * Runs the gates in the run's worktree. A gate that fails on the branch is the BRANCH's failure only
 * if the base (run.baseSha) does not fail the same way: these repos carry red tests of their own
 * (measured 2026-10-05: a docs-only ascent branch and a test-clock pin in pof were held by tests
 * neither could have touched). Each failed gate is re-run once on the base; failures that are all
 * inherited are recorded, not blocking. A failure only the branch shows may still be load
 * flakiness (2026-10-05, pof: a mermaid click test failed in the full run, passed alone): the newly
 * failing test files re-run once alone, and a pass clears them. Then anything the gates left dirty
 * (vitest rewrote snapshots in both first runs, 2026-10-05) is recorded and reverted, so the
 * worktree is the committed tip again for a retry, a rebase and the merge.
 */
export function evaluateGates(run, gates, { timeoutMs = GATE_TIMEOUT_MS } = {}) {
  const env = repoEnv(repoOf(run).root);   // the Personas repo's gates share its one cargo target
  const results = runGates(run.worktree, gates, { timeoutMs, env });
  for (const g of Object.keys(results)) {
    const r = results[g];
    if (r.skipped || r.ok || r.timedOut || !r.failures?.length || !run.baseSha) continue;
    try {
      const base = withBaseWorktree(run, (dir) => runGates(dir, gates, { timeoutMs, only: [g], env })[g]);
      r.base = { ok: base.ok, exit: base.exit, failures: base.failures?.length ?? 0, failureList: (base.failures || []).slice(0, 100) };
      if (!base.ok && failuresAreInherited(r.failures, base.failures)) r.inherited = true;
    } catch (e) { r.base = { error: String(e.message || e).split('\n')[0] }; }
    if (!r.inherited) {
      const baseSet = new Set(r.base?.failureList || []);
      const fresh = (r.failures || []).filter((f) => !baseSet.has(f));
      const files = testFilesIn(fresh).slice(0, 12);
      if (files.length && g === 'test') {
        const again = runGates(run.worktree, { [g]: narrowCommand(gates[g], files) }, { timeoutMs, only: [g], env })[g];
        r.rerun = { files, ok: again.ok, exit: again.exit };
        if (again.ok) { r.flaky = files; r.inherited = true; }
      }
    }
  }
  const effects = worktreeDirty(run.worktree);
  if (effects.length) {
    gitTry(run.worktree, ['checkout', '--', '.']);
    gitTry(run.worktree, ['clean', '-fdq', '-e', 'node_modules']);
  }
  return { results, sideEffects: effects.slice(0, 20) };
}

/** The hold reason for a gate verdict, or null when it may merge. */
function gateFailure(results, when = '') {
  const gv = gatesVerdict(results);
  if (!gv.ran.length) return `no verifiable gate${when} (every gate was skipped: no command)`;
  if (!gv.failed.length) return null;
  const g = gv.failed[0], r = results[g];
  return `gate ${g} failed${when} (exit ${r.exit}${r.timedOut ? ', timed out' : ''}): ${lastLines(r.tail, 5)}`;
}

// ---------------------------------------------------------------- merge gate

/**
 * (run: Run, verdict) => {ok:boolean, reason?:string, sha?:string, dirtyOverlap?:string[], rebased?:boolean, rebasedOnto?:string}
 * (a) checkout on baseBranch, no merge/rebase/cherry-pick in progress; (b) a base that moved WHILE
 * the gates ran means a clean worktree rebase and the FULL gates again on the rebased tip (the
 * pre-gate rebase in settle covers a base that moved before); (c) checkout dirty paths do not
 * intersect the branch's diff; (d) `merge --ff-only` and HEAD == branch tip afterwards. Mutates
 * `verdict` with what it measured. `rebasedOnto` tells settle to record the branch's new base.
 */
export function mergeGate(run, verdict = {}, { gates, timeoutMs = GATE_TIMEOUT_MS } = {}) {
  const { root, baseBranch } = repoOf(run);   // the target repo's checkout: a second repo merges into ITS base
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
  let rebased = false, rebasedOnto;
  if (!isAncestor(root, baseNow, branchRef)) {
    const rb = rebaseOntoBase(run);
    if (!rb.ok) return { ok: false, reason: rb.reason };
    if (rb.rebased) {
      rebased = true; rebasedOnto = rb.onto; baseNow = rb.onto;
      verdict.rebasedOnto = rb.onto;
      const g = gates || resolveRunGates(run, loadBrief(run.slug) || {});
      const ev = evaluateGates({ ...run, baseSha: rb.onto }, g, { timeoutMs });
      verdict.gatesAfterRebase = ev.results;
      if (ev.sideEffects.length) verdict.gateSideEffectsAfterRebase = ev.sideEffects;
      const fail = gateFailure(ev.results, ' after rebasing onto the moved base');
      if (fail) return { ok: false, rebased, rebasedOnto, reason: fail };
      verdict.commits = lines(git(root, ['rev-list', '--reverse', `${baseNow}..${branchRef}`]));
    }
  }
  verdict.rebased = Boolean(verdict.rebased || rebased);
  verdict.files = lines(git(root, ['diff', '--name-only', '--no-renames', `${baseNow}..${branchRef}`]));

  const dirty = new Set(dirtyPaths(root).map(keyOf));
  const overlap = verdict.files.filter((f) => dirty.has(keyOf(f)));
  verdict.dirtyOverlap = overlap;
  if (overlap.length) return { ok: false, rebased, rebasedOnto, dirtyOverlap: overlap, reason: `uncommitted changes in the checkout overlap the branch: ${overlap.join(', ')}` };

  const tip = revParse(root, branchRef);
  const m = gitTry(root, ['merge', '--ff-only', branchRef]);
  if (!m.ok) return { ok: false, rebased, rebasedOnto, reason: `merge --ff-only refused: ${lastLines(m.err || m.out, 3)}` };
  const after = git(root, ['rev-parse', 'HEAD']);
  if (after !== tip) return { ok: false, rebased, rebasedOnto, reason: `after the merge HEAD is ${after.slice(0, 10)}, not the branch tip ${tip.slice(0, 10)}` };
  return { ok: true, sha: tip, rebased, rebasedOnto, dirtyOverlap: [] };
}

// ---------------------------------------------------------------- settle

/** The run once its branch sits on a new base: baseSha follows, the cut-time base is kept once. */
const rebasedRun = (run, onto) => updateRun(run, { baseSha: onto, originalBaseSha: run.originalBaseSha ?? run.baseSha, rebasedAt: nowIso() });

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
  // one settler per run: an `await` in another process owns this run until it settles or gives up
  const awaiter = awaitHolder(run);
  if (awaiter && awaiter.pid !== process.pid) throw new Refusal('awaited', { runId: run.runId, slug: run.slug, awaitPid: awaiter.pid, since: awaiter.at, hint: 'an `await` is already settling this run; let it finish, never settle beside it' });
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

  const { root } = repoOf(run);
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
  // what the builder touched beyond the paths it declared: recorded for the master, not a hold
  // (the declaration keeps two builders apart; a rebase conflict is what actually stops a collision)
  if (Array.isArray(run.paths) && run.paths.length) {
    const inside = new Set(boundaryHits(verdict.files, run.paths).map((h) => h.file));
    const outside = verdict.files.filter((f) => !inside.has(f));
    if (outside.length) verdict.outsidePaths = outside.slice(0, 20);
  }

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

  // 2a. a base that moved since the cut (another builder of this project merged first, or the
  // operator committed): rebase onto its tip NOW, under the gate slot (merges only happen under it),
  // so the gates below verify exactly what would merge. A conflict aborts and holds.
  const rb = rebaseOntoBase(run);
  if (!rb.ok) return hold(run, rb.reason, verdict);
  if (rb.rebased) {
    run = rebasedRun(run, rb.onto);
    verdict.rebased = true; verdict.rebasedOnto = rb.onto; verdict.rebasedFrom = rb.from;
    verdict.commits = lines(git(root, ['rev-list', '--reverse', `${rb.onto}..${branchRef}`]));
    verdict.files = lines(git(root, ['diff', '--name-only', '--no-renames', `${rb.onto}..${branchRef}`]));
    if (!verdict.commits.length) return hold(run, `rebasing onto the moved base ${rb.onto.slice(0, 10)} left no commits: every change of the branch is already in the base`, verdict);
  }

  // 2b. run them (the target repo's gates: a second repo has its own)
  const gates = resolveRunGates(run, brief);
  const timeoutMs = Number(process.env.APPMASTER_GATE_TIMEOUT_MS) || GATE_TIMEOUT_MS;
  const ev = evaluateGates(run, gates, { timeoutMs });
  verdict.gates = ev.results;
  verdict.gateSources = gates.sources;
  if (ev.sideEffects.length) verdict.gateSideEffects = ev.sideEffects;
  const fail = gateFailure(verdict.gates);
  if (fail) return hold(run, fail, verdict);

  // 3. the merge gate
  const mg = mergeGate(run, verdict, { gates, timeoutMs });
  if (mg.rebasedOnto) run = rebasedRun(run, mg.rebasedOnto);
  if (!mg.ok) return hold(run, mg.reason, verdict);

  // queue BEFORE recording merged: the entry is idempotent, and a crash in between leaves a
  // `verifying` run whose re-settle finds the branch already in base and queues the same id again
  const repoKey = repoOf(run).key;
  queueOutbox(run.slug, run.project.id, 'task-complete',
    { ideaIds: run.ideaIds || [], sha: mg.sha, title: taskTitle(run), runId: run.runId, branch: run.branch, ...(repoKey !== SELF_REPO ? { repo: repoKey } : {}) }, { runId: run.runId });
  closeHeldAsks(run, mg.sha);
  run = updateRun(run, { state: 'merged', mergedSha: mg.sha, verdict, endedAt: run.endedAt || nowIso(), settledAt: nowIso() });
  let cleanup;
  try { cleanup = removeWorktree(run); } catch (e) { cleanup = { error: e.message }; }
  return updateRun(run, { cleanup });
}
