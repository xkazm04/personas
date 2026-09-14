// Overlay: the set of files where a worktree differs from the warm base checkout.
//
//   computeOverlay({ baseRoot, baseHead, root }) ->
//     { base: { root, head }, root,
//       files: [ { path, status: 'modified'|'added'|'deleted', content?, binary? } ] }
//
// `path` is repo-relative posix. `content` is the worktree's text (utf8) when the
// file is < 2 MB and looks like text; otherwise `binary: true` and no content.
// The candidate set is the union of
//   (a) files that differ between <baseHead> and the worktree's working tree
//   (b) files untracked in the worktree
//   (c) files dirty or untracked in the BASE checkout (a sibling session's edits):
//       the program must see the worktree's version of those, so they are re-read
//       from `root`, or marked deleted when `root` does not have them.
// Build-output directories that no gate reads are dropped (see IGNORED_DIRS).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const MAX_CONTENT_BYTES = 2 * 1024 * 1024;

/** Directories no gate ever reads; untracked build output lives here (6 GB of it in the base). */
export const IGNORED_DIRS = [
  'node_modules',
  'dist',
  'target',
  '.personas-e2e-target',
  'src-tauri/target',
  'src-tauri/gen',
  '.git',
];

export class OverlayError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OverlayError';
    this.code = code;
  }
}

export function toPosix(p) {
  return path.resolve(p).replace(/\\/g, '/');
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function splitZ(out) {
  return out.split('\0').filter(Boolean);
}

function realKey(p) {
  let r;
  try {
    r = fs.realpathSync.native(p);
  } catch {
    r = path.resolve(p);
  }
  r = r.replace(/\\/g, '/');
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

export function sameDirectory(a, b) {
  return realKey(a) === realKey(b);
}

export function gitCommonDir(root) {
  return git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
}

export function gitHead(root) {
  return git(root, ['rev-parse', 'HEAD']).trim();
}

/** Repo top level of a directory (throws when not in a git repo). */
export function gitTopLevel(dir) {
  return toPosix(git(dir, ['rev-parse', '--show-toplevel']).trim());
}

/** The main checkout for any worktree: the parent of the shared git common dir. */
export function baseRootOf(dir) {
  return toPosix(path.dirname(gitCommonDir(dir)));
}

/** Top-level directory name test against IGNORED_DIRS (also matches `target-*`). */
export function isIgnoredPath(rel) {
  const first = rel.split('/')[0];
  if (first.startsWith('target-') || first === 'target') return true;
  for (const d of IGNORED_DIRS) {
    if (rel === d || rel.startsWith(d + '/')) return true;
  }
  return false;
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** `git diff --name-status -z --no-renames <rev>` -> Map<path, statusLetter> */
function diffNameStatus(cwd, rev) {
  const out = git(cwd, ['diff', '--name-status', '-z', '--no-renames', '--diff-filter=ACDMR', rev]);
  const parts = splitZ(out);
  const map = new Map();
  for (let i = 0; i + 1 < parts.length; i += 2) {
    map.set(parts[i + 1], parts[i][0]);
  }
  return map;
}

function untracked(cwd) {
  return splitZ(git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']));
}

function statFile(p) {
  try {
    const st = fs.statSync(p);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

function readEntry(rel, abs, st, status) {
  const entry = { path: rel, status };
  if (st.size >= MAX_CONTENT_BYTES) {
    entry.binary = true;
    entry.size = st.size;
    return entry;
  }
  const buf = fs.readFileSync(abs);
  if (looksBinary(buf)) {
    entry.binary = true;
    entry.size = st.size;
    return entry;
  }
  entry.content = buf.toString('utf8');
  return entry;
}

/** Files dirty or untracked against HEAD in one checkout (used by the client's cold fallback). */
export function dirtyAgainstHead(root) {
  const set = new Set();
  for (const [p] of diffNameStatus(root, 'HEAD')) set.add(p);
  for (const p of untracked(root)) set.add(p);
  return [...set].filter((p) => !isIgnoredPath(p)).sort();
}

/**
 * @param {{ baseRoot: string, baseHead?: string, root: string }} opts
 */
export function computeOverlay({ baseRoot, baseHead, root }) {
  const base = toPosix(baseRoot);
  const rootP = toPosix(root);
  if (!fs.existsSync(rootP)) throw new OverlayError('ROOT_MISSING', `root does not exist: ${rootP}`);
  const head = baseHead || gitHead(base);

  if (sameDirectory(base, rootP)) {
    return { base: { root: base, head }, root: rootP, files: [] };
  }

  const common = [gitCommonDir(base), gitCommonDir(rootP)];
  if (realKey(common[0]) !== realKey(common[1])) {
    throw new OverlayError(
      'DIFFERENT_REPO',
      `root ${rootP} does not share a git common dir with base ${base} (${common[1]} vs ${common[0]})`,
    );
  }

  const candidates = new Set();
  for (const [p] of diffNameStatus(rootP, head)) candidates.add(p);
  for (const p of untracked(rootP)) candidates.add(p);
  for (const [p] of diffNameStatus(base, 'HEAD')) candidates.add(p);
  for (const p of untracked(base)) candidates.add(p);

  const files = [];
  for (const rel of [...candidates].sort()) {
    if (isIgnoredPath(rel)) continue;
    const inRoot = statFile(path.join(rootP, rel));
    const inBase = statFile(path.join(base, rel));
    if (inRoot) {
      files.push(readEntry(rel, path.join(rootP, rel), inRoot, inBase ? 'modified' : 'added'));
    } else if (inBase) {
      files.push({ path: rel, status: 'deleted' });
    }
    // absent on both sides: nothing for a program to see either way
  }

  return { base: { root: base, head }, root: rootP, files };
}

export function summarizeOverlay(overlay) {
  let changed = 0;
  let deleted = 0;
  let added = 0;
  for (const f of overlay.files) {
    if (f.status === 'deleted') deleted++;
    else if (f.status === 'added') added++;
    else changed++;
  }
  return { changed, deleted, untracked: added, total: overlay.files.length };
}
