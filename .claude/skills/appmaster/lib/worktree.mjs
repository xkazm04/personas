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
// One whole-dir junction per package dir, unless that node_modules holds WORKSPACE links (npm/pnpm
// workspaces link @scope/<pkg> to the checkout's own packages/<pkg>): then a real dir of per-entry
// links whose workspace entries point back into the worktree (linkOne).

/**
 * The package dirs whose node_modules a worktree needs, relative to the root: the root itself, and
 * each top-level directory holding both a package.json and an installed node_modules (2026-10-07:
 * firetv's gate is `cd desk && npm run test:rules`, and desk/node_modules was never linked, so every
 * firetv run failed "Run `npm install` in desk/ first"). Workspace packages one level further down
 * count too (2026-10-09: athena-portable's pnpm workspace keeps them in apps/desktop,
 * packages/athena-bridge and examples/*, and with only the root linked every gate failed 'tsc is not
 * recognized'). Deeper than two levels is not scanned: no managed repo nests packages deeper.
 */
export function nodeModulesDirs(root) {
  const rels = [''];
  const isPackage = (dir) => fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'node_modules'));
  const subdirs = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .map((e) => e.name);
    } catch { return []; }
  };
  for (const name of subdirs(root)) {
    if (isPackage(path.join(root, name))) { rels.push(name); continue; }
    for (const sub of subdirs(path.join(root, name))) {
      if (isPackage(path.join(root, name, sub))) rels.push(path.join(name, sub));
    }
  }
  return rels;
}

/**
 * The marker a per-entry node_modules layout carries (see linkOne). A real node_modules WITHOUT it
 * is somebody's install and is never replaced; one WITH it is ours to refill and to take apart.
 * It lists the top-level files copied in (lockfile caches such as .package-lock.json and
 * .modules.yaml: a file cannot be junctioned, and a copy cannot write back into the checkout).
 */
export const LAYOUT_MARKER = '.appmaster-links.json';

/** The real path of a link, or null when it dangles. */
const realOrNull = (p) => { try { return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p); } catch { return null; } };

/**
 * Workspace links in one node_modules dir (2026-10-25: mage-arena's @mage/* resolved to the MAIN
 * checkout's packages/core from a worktree, so a builder's new export failed TS2305, and a write
 * through the link would land in the checkout). An entry is one when it is a link whose real path
 * lies inside the root but under no node_modules (that excludes the pnpm store and every real
 * install). Scoped entries (@scope/<pkg>) are read one level down.
 * => Map(entry name, e.g. '@ws/core' with the platform separator -> path relative to the root)
 */
export function workspaceLinks(root, source) {
  const rootReal = realOrNull(root);
  const out = new Map();
  if (!rootReal) return out;
  const check = (name) => {
    const st = lstatOrNull(path.join(source, name));
    if (!st || !st.isSymbolicLink()) return;
    const target = realOrNull(path.join(source, name));
    if (!target) return;
    const rel = path.relative(rootReal, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return;
    if (rel.split(/[\\/]+/).some((seg) => seg.toLowerCase() === 'node_modules')) return;
    out.set(name, rel);
  };
  let names = [];
  try { names = fs.readdirSync(source); } catch { return out; }
  for (const name of names) {
    const st = lstatOrNull(path.join(source, name));
    if (name.startsWith('@') && st && st.isDirectory() && !st.isSymbolicLink()) {
      let subs = [];
      try { subs = fs.readdirSync(path.join(source, name)); } catch { /* unreadable scope: nothing to link */ }
      for (const sub of subs) check(path.join(name, sub));
    } else check(name);
  }
  return out;
}

/** Junction link -> target (an existing dir), replacing only a LINK that points elsewhere, and prove it. */
function ensureJunction(link, target) {
  const st = lstatOrNull(link);
  if (st && !st.isSymbolicLink()) throw new Error(`${link} exists and is not a junction; refusing to replace it`);
  if (st && realOrNull(link) && real(link) === real(target)) return;
  if (st) unlinkJunction(link);
  fs.symlinkSync(fs.realpathSync(target), link, 'junction');
  const after = lstatOrNull(link);
  if (!after || !after.isSymbolicLink() || real(link) !== real(target)) {
    if (after && after.isSymbolicLink()) unlinkJunction(link);
    throw new Error(`${link} is not a junction to ${target}`);
  }
}

const readMarker = (dir) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, LAYOUT_MARKER), 'utf8')); } catch { return null; }
};

/**
 * Build <worktree>/<rel>/node_modules as a REAL dir of per-entry links: each ordinary entry is a
 * junction to the root's, each workspace link points at the WORKTREE's own package (the same path
 * relative to the root), so the worktree typechecks and builds against its own code and nothing
 * can write through into the checkout. A workspace package the worktree does not have is left
 * out rather than pointed at the checkout's copy: a missing module fails honestly.
 */
function linkLayout(worktree, source, link, wsLinks) {
  if (!lstatOrNull(link)) fs.mkdirSync(link);
  const files = new Set(readMarker(link)?.files || []);
  // the marker goes in first, so a layout interrupted half-way is still recognised as ours
  const writeMarker = () => fs.writeFileSync(path.join(link, LAYOUT_MARKER), JSON.stringify({ files: [...files].sort() }, null, 2) + '\n');
  writeMarker();
  const place = (name) => {
    const src = path.join(source, name), dst = path.join(link, name);
    if (wsLinks.has(name)) {
      const target = path.join(worktree, wsLinks.get(name));
      if (fs.existsSync(target)) ensureJunction(dst, target);
      else { const st = lstatOrNull(dst); if (st && st.isSymbolicLink()) unlinkJunction(dst); }
      return;
    }
    let st;
    try { st = fs.statSync(src); } catch { return; }   // a dangling entry in the checkout: nothing to link
    if (st.isDirectory()) ensureJunction(dst, src);
    else if (st.isFile()) {
      const have = lstatOrNull(dst);
      if (have && (have.isSymbolicLink() || !files.has(name))) throw new Error(`${dst} exists and was not copied by appmaster; refusing to replace it`);
      if (!have) { fs.copyFileSync(src, dst); files.add(name); writeMarker(); }
    }
  };
  for (const name of fs.readdirSync(source)) {
    if (name === LAYOUT_MARKER) continue;
    const st = lstatOrNull(path.join(source, name));
    const scoped = name.startsWith('@') && st && st.isDirectory() && !st.isSymbolicLink()
      && [...wsLinks.keys()].some((k) => k.startsWith(name + path.sep));
    if (scoped) {
      const dir = path.join(link, name);
      const have = lstatOrNull(dir);
      if (have && have.isSymbolicLink()) unlinkJunction(dir);   // a scope junctioned whole on an earlier pass
      if (!lstatOrNull(dir)) fs.mkdirSync(dir);
      for (const sub of fs.readdirSync(path.join(source, name))) place(path.join(name, sub));
    } else place(name);
  }
}

/**
 * Take a per-entry layout apart: links only (never followed), then the files the marker says were
 * copied, then the marker, then each scope dir and the dir itself when empty (rmdir, never a
 * recursive delete). Every link's target must still exist afterwards, or this throws before any
 * git removal can run.
 */
function unlinkLayout(link) {
  const files = new Set(readMarker(link)?.files || []);
  const dropLink = (p) => {
    const target = realOrNull(p);
    unlinkJunction(p);
    if (target && !fs.existsSync(target)) throw new Error(`${target} vanished while unlinking ${p}; stopping before any git removal`);
  };
  for (const name of fs.readdirSync(link)) {
    const p = path.join(link, name);
    const st = lstatOrNull(p);
    if (!st) continue;
    if (st.isSymbolicLink()) dropLink(p);
    else if (st.isDirectory() && name.startsWith('@')) {
      for (const sub of fs.readdirSync(p)) {
        const sp = path.join(p, sub);
        const sst = lstatOrNull(sp);
        if (sst && sst.isSymbolicLink()) dropLink(sp);
      }
      try { fs.rmdirSync(p); } catch { /* something real was added inside: git removes it, no link remains */ }
    } else if (st.isFile() && files.has(name)) fs.unlinkSync(p);
  }
  try { fs.unlinkSync(path.join(link, LAYOUT_MARKER)); } catch { /* already gone */ }
  try { fs.rmdirSync(link); } catch { /* not empty: only real files a builder made are left, no link */ }
  return true;
}

/**
 * Link one <worktree>/<rel>/node_modules from <root>/<rel>/node_modules and PROVE it.
 * No workspace links in it: one junction to the real dir, exactly as before -> 'junction'.
 * Workspace links: a real dir of per-entry links (linkLayout) -> 'workspace'.
 * A real node_modules that is neither a link nor our marked layout is refused.
 */
function linkOne(root, worktree, rel) {
  const source = path.join(root, rel, 'node_modules'), link = path.join(worktree, rel, 'node_modules');
  if (!fs.existsSync(source) || !fs.existsSync(path.join(worktree, rel))) return 'none';
  const st = lstatOrNull(link);
  const ours = !!st && !st.isSymbolicLink() && st.isDirectory() && !!readMarker(link);
  if (st && !st.isSymbolicLink() && !ours) throw new Error(`${link} exists and is not a junction; refusing to replace it`);
  const wsLinks = workspaceLinks(root, source);
  if (wsLinks.size) {
    if (st && st.isSymbolicLink()) unlinkJunction(link);   // a whole-dir junction from an earlier pass
    linkLayout(worktree, source, link, wsLinks);
    return 'workspace';
  }
  if (ours) unlinkLayout(link);   // the checkout no longer has workspace links: back to one junction
  if (!lstatOrNull(link)) fs.symlinkSync(fs.realpathSync(source), link, 'junction');
  const after = lstatOrNull(link);
  if (!after || !after.isSymbolicLink() || real(link) !== real(source)) {
    if (after && after.isSymbolicLink()) unlinkJunction(link);
    throw new Error(`node_modules at ${link} is not a junction to ${source}`);
  }
  return 'junction';
}

/**
 * Link every package's node_modules into the worktree (nodeModulesDirs). Returns what the ROOT's
 * got: 'junction' (one whole-dir junction), 'workspace' (a real dir of per-entry links whose
 * workspace packages resolve inside the worktree), or 'none' (no root node_modules to link).
 */
export function linkNodeModules(root, worktree) {
  let rootLinked = 'none';
  for (const rel of nodeModulesDirs(root)) {
    const linked = linkOne(root, worktree, rel);
    if (rel === '') rootLinked = linked;
  }
  return rootLinked;
}

/**
 * Unlink every node_modules link in a worktree (the nested ones and the per-entry layouts too),
 * and assert each real node_modules survived. Always before any `git worktree remove`: a forced
 * remove must never meet a junction.
 */
export function unlinkNodeModules(root, worktree) {
  let any = false;
  for (const rel of nodeModulesDirs(root)) {
    const link = path.join(worktree, rel, 'node_modules');
    const source = path.join(root, rel, 'node_modules');
    const hadSource = fs.existsSync(source);
    const st = lstatOrNull(link);
    if (st && st.isSymbolicLink()) any = unlinkJunction(link) || any;
    else if (st && st.isDirectory() && readMarker(link)) any = unlinkLayout(link) || any;
    if (hadSource && !fs.existsSync(source)) throw new Error(`the real node_modules at ${source} vanished; stopping before any git removal`);
  }
  return any;
}

/**
 * (dir) => number   // links removed
 * Unlink EVERY symlink or junction under `dir`, wherever it points, without descending into one, so a
 * later recursive delete of `dir` cannot follow a link into the main checkout. unlinkNodeModules only
 * knows the junctions the harness made; a link made by anyone else inside a worktree (a builder, a gate,
 * the Director) was followed by `git worktree remove --force` on 2026-10-26 and emptied packages in the
 * main checkout's pnpm store. `.git` is skipped (a worktree's .git is a file, never a link to follow).
 */
export function unlinkAllLinks(dir) {
  let n = 0;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      const st = lstatOrNull(p);
      if (!st) continue;
      if (st.isSymbolicLink()) { if (unlinkJunction(p)) n += 1; continue; }
      if (st.isDirectory()) walk(p);
    }
  };
  if (lstatOrNull(dir)?.isDirectory()) walk(dir);
  return n;
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
/**
 * (root, dir) => boolean   // true when dir is gone afterwards
 * `git worktree remove --force` deregisters a worktree but on Windows can leave its folder behind
 * (a gate's real node_modules install), and a fixed-name base checkout then fails the next
 * `worktree add` with "already exists" (CastleControl verify, 2026-10-25). Only a folder under
 * WORKTREE_ROOT that git no longer lists is swept, with `rmdir /s /q`, which removes a junction
 * as a link and never descends into its target.
 */
export function sweepLeftoverDir(root, dir) {
  if (!fs.existsSync(dir)) return true;
  if (!isUnder(dir, WORKTREE_ROOT)) return false;
  const listed = gitTry(root, ['worktree', 'list', '--porcelain']);
  if (listed.ok && listed.out.split(/\r?\n/).some((l) => l.startsWith('worktree ') && norm(l.slice(9)) === norm(dir))) return false;
  unlinkAllLinks(dir);
  // the gate's processes may still hold files for a moment after they exit (2026-10-25: merged runs'
  // folders survived the first pass and went the second), so a failed pass is retried a few times
  for (let attempt = 0; attempt < 4 && fs.existsSync(dir); attempt += 1) {
    if (attempt) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    try {
      if (process.platform === 'win32') execFileSync('cmd', ['/d', '/c', 'rmdir', '/s', '/q', path.resolve(dir)], { stdio: 'ignore', windowsHide: true });
      else fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* retried, then reported by the caller through the return value */ }
  }
  return !fs.existsSync(dir);
}

export function removeWorktree(run) {
  const { root, baseBranch } = repoOf(run);
  const out = { removed: false, branchDeleted: false, junction: false };
  const worktree = run.worktree;
  if (worktree) {
    if (!isUnder(worktree, WORKTREE_ROOT)) throw new Error(`refusing to remove ${worktree}: not under ${WORKTREE_ROOT}`);
    out.junction = unlinkNodeModules(root, worktree);
    out.links = unlinkAllLinks(worktree);
    if (fs.existsSync(worktree)) {
      const r = gitTry(root, ['worktree', 'remove', '--force', worktree]);
      if (!r.ok) throw new Error(`git worktree remove ${worktree}: ${r.err}`);
    }
    gitTry(root, ['worktree', 'prune']);
    out.removed = sweepLeftoverDir(root, worktree);
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
  if (fs.existsSync(dir)) { unlinkNodeModules(root, dir); unlinkAllLinks(dir); gitTry(root, ['worktree', 'remove', '--force', dir]); gitTry(root, ['worktree', 'prune']); sweepLeftoverDir(root, dir); }
  git(root, ['worktree', 'add', '--detach', dir, run.baseSha]);
  try {
    linkNodeModules(root, dir);
    return fn(dir);
  } finally {
    unlinkNodeModules(root, dir);
    unlinkAllLinks(dir);
    gitTry(root, ['worktree', 'remove', '--force', dir]);
    gitTry(root, ['worktree', 'prune']);
    sweepLeftoverDir(root, dir);
  }
}
