// One isolated git worktree per run (WP2), cut OUTSIDE every repo under WORKTREE_ROOT, plus the
// git helpers merge.mjs shares. Must never touch the project checkout's working files, never
// shell out to `ln` (MSYS copies a 400-package node_modules instead of linking it), never delete
// recursively through a junction, and never delete a branch that is not merged into its base.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WORKTREE_ROOT, shortId, slugify, repoOf } from './contract.mjs';

// ---------------------------------------------------------------- git

/** git -C <cwd> ...args -> trimmed stdout; throws with stderr on a non-zero exit. */
export function git(cwd, args, opts = {}) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 64 * 2 ** 20, ...opts,
    }).replace(/\s+$/, '');
  } catch (e) {
    const msg = `${e.stderr || ''}${e.stdout || ''}`.trim() || e.message;
    const err = new Error(`git ${args.join(' ')} (in ${cwd}): ${msg}`);
    err.status = e.status; err.stderr = e.stderr; err.stdout = e.stdout;
    throw err;
  }
}
/** Same, but never throws: {ok, status, out, err}. */
export function gitTry(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 2 ** 20 });
  return { ok: r.status === 0, status: r.status, out: (r.stdout || '').replace(/\s+$/, ''), err: (r.stderr || '').trim() };
}
export const revParse = (cwd, ref) => git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
export const isAncestor = (cwd, a, b) => gitTry(cwd, ['merge-base', '--is-ancestor', a, b]).ok;

/** The branch name a run's builder works on. */
export const branchFor = (run) => `autopilot/${slugify(run.charterSlug || 'task')}-${shortId(run.runId)}`;
/** Where a run's worktree lives. */
export const worktreePathFor = (run) => path.join(WORKTREE_ROOT, run.slug, shortId(run.runId));

const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
const real = (p) => norm(fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p));
function isUnder(child, parent) {
  const rel = path.relative(norm(parent), norm(child));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
const lstatOrNull = (p) => { try { return fs.lstatSync(p); } catch { return null; } };

// ---------------------------------------------------------------- node_modules junction

/**
 * The package dirs whose node_modules a worktree needs, relative to the root: the root itself, and
 * each top-level directory holding both a package.json and an installed node_modules (2026-10-07:
 * firetv's gate is `cd desk && npm run test:rules`, and desk/node_modules was never linked, so every
 * firetv run failed "Run `npm install` in desk/ first").
 */
export function nodeModulesDirs(root) {
  const rels = [''];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return rels; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
    const dir = path.join(root, e.name);
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'node_modules'))) rels.push(e.name);
  }
  return rels;
}

/** Junction one <worktree>/<rel>/node_modules -> <root>/<rel>/node_modules and PROVE it is a link to the real dir. */
function linkOne(root, worktree, rel) {
  const source = path.join(root, rel, 'node_modules'), link = path.join(worktree, rel, 'node_modules');
  if (!fs.existsSync(source) || !fs.existsSync(path.join(worktree, rel))) return false;
  const st = lstatOrNull(link);
  if (st && !st.isSymbolicLink()) throw new Error(`${link} exists and is not a junction; refusing to replace it`);
  if (!st) fs.symlinkSync(fs.realpathSync(source), link, 'junction');
  const after = lstatOrNull(link);
  if (!after || !after.isSymbolicLink() || real(link) !== real(source)) {
    if (after && after.isSymbolicLink()) unlinkJunction(link);
    throw new Error(`node_modules at ${link} is not a junction to ${source}`);
  }
  return true;
}

/** Junction every package's node_modules into the worktree (nodeModulesDirs); 'junction' when the root's was linked. */
export function linkNodeModules(root, worktree) {
  let rootLinked = false;
  for (const rel of nodeModulesDirs(root)) {
    const linked = linkOne(root, worktree, rel);
    if (rel === '') rootLinked = linked;
  }
  return rootLinked ? 'junction' : 'none';
}

/**
 * Unlink every node_modules junction in a worktree (the nested ones too), and assert each real
 * node_modules survived. Always before any `git worktree remove`: a forced remove must never meet a junction.
 */
export function unlinkNodeModules(root, worktree) {
  let any = false;
  for (const rel of nodeModulesDirs(root)) {
    const link = path.join(worktree, rel, 'node_modules');
    const source = path.join(root, rel, 'node_modules');
    const hadSource = fs.existsSync(source);
    const st = lstatOrNull(link);
    if (st && st.isSymbolicLink()) any = unlinkJunction(link) || any;
    if (hadSource && !fs.existsSync(source)) throw new Error(`the real node_modules at ${source} vanished; stopping before any git removal`);
  }
  return any;
}

/** Remove a junction itself, never what it points at. */
export function unlinkJunction(link) {
  const st = lstatOrNull(link);
  if (!st) return false;
  if (!st.isSymbolicLink()) throw new Error(`${link} is not a link; refusing to unlink`);
  try { fs.unlinkSync(link); } catch { fs.rmdirSync(link); }
  if (lstatOrNull(link)) throw new Error(`junction ${link} survived unlink`);
  return true;
}

// ---------------------------------------------------------------- create / remove

/**
 * (run: Run, brief: Brief) => {worktree, branch, baseSha, nodeModules}
 * Cut from the LOCAL base branch tip of the repo the run targets (repoOf: the project's own checkout,
 * or a second repo its brief names). Idempotent: a run whose worktree already exists on its branch
 * (a dispatch that crashed after this step) gets the same worktree back.
 */
export function createWorktree(run, _brief = {}) {
  const { root, baseBranch } = repoOf(run);
  const branch = run.branch || branchFor(run);
  const worktree = run.worktree || worktreePathFor(run);
  if (!isUnder(worktree, WORKTREE_ROOT)) throw new Error(`worktree ${worktree} is not under ${WORKTREE_ROOT}`);
  if (isUnder(worktree, root) || norm(worktree) === norm(root)) throw new Error(`worktree ${worktree} would sit inside the checkout ${root}`);

  let baseSha;
  if (fs.existsSync(worktree)) {
    const head = gitTry(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (!head.ok || head.out !== branch) throw new Error(`${worktree} exists but is not a worktree on ${branch}`);
    baseSha = run.baseSha || git(root, ['merge-base', `refs/heads/${baseBranch}`, branch]);
  } else {
    baseSha = revParse(root, `refs/heads/${baseBranch}`);
    fs.mkdirSync(path.dirname(worktree), { recursive: true });
    if (gitTry(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok) {
      throw new Error(`branch ${branch} already exists in ${root} without its worktree`);
    }
    git(root, ['worktree', 'add', '-b', branch, worktree, baseSha]);
  }
  const nodeModules = linkNodeModules(root, worktree);
  return { worktree, branch, baseSha, nodeModules };
}

/**
 * (run: Run) => {removed, branchDeleted, junction}
 * Unlinks the node_modules junction FIRST and asserts the real node_modules survived, then
 * `git worktree remove --force`, then deletes the branch only when its tip is merged into base.
 */
export function removeWorktree(run) {
  const { root, baseBranch } = repoOf(run);
  const out = { removed: false, branchDeleted: false, junction: false };
  const worktree = run.worktree;
  if (worktree) {
    if (!isUnder(worktree, WORKTREE_ROOT)) throw new Error(`refusing to remove ${worktree}: not under ${WORKTREE_ROOT}`);
    out.junction = unlinkNodeModules(root, worktree);
    if (fs.existsSync(worktree)) {
      const r = gitTry(root, ['worktree', 'remove', '--force', worktree]);
      if (!r.ok) throw new Error(`git worktree remove ${worktree}: ${r.err}`);
    }
    gitTry(root, ['worktree', 'prune']);
    out.removed = !fs.existsSync(worktree);
  }
  const branch = run.branch;
  if (branch && gitTry(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok
      && isAncestor(root, `refs/heads/${branch}`, `refs/heads/${baseBranch}`)) {
    out.branchDeleted = gitTry(root, ['branch', '-D', branch]).ok;
  }
  return out;
}

/**
 * (run: Run, fn: (dir: string) => T) => T
 * A throwaway detached checkout of the run's baseSha, with the project's node_modules junctioned in,
 * for measuring what a gate says about the BASE. Always removed afterwards, junction first.
 */
export function withBaseWorktree(run, fn) {
  const { root } = repoOf(run);
  const dir = path.join(WORKTREE_ROOT, run.slug, `base-${shortId(run.runId)}`);
  if (!isUnder(dir, WORKTREE_ROOT)) throw new Error(`base worktree ${dir} is not under ${WORKTREE_ROOT}`);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  if (fs.existsSync(dir)) { unlinkNodeModules(root, dir); gitTry(root, ['worktree', 'remove', '--force', dir]); }
  git(root, ['worktree', 'add', '--detach', dir, run.baseSha]);
  try {
    linkNodeModules(root, dir);
    return fn(dir);
  } finally {
    unlinkNodeModules(root, dir);
    gitTry(root, ['worktree', 'remove', '--force', dir]);
    gitTry(root, ['worktree', 'prune']);
  }
}
