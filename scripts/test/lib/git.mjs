// Shared git helpers for the harness — the read-only working-tree probes that
// were copy-pasted across run.mjs / regather.mjs / watchgather.mjs /
// longitudinal.mjs (head 4×, statusFingerprint 2×). Each returns null on error
// (e.g. a non-repo path) rather than throwing — preserving the inline behavior
// exactly. Verified in tests/cli/git.test.mjs against a temp repo.
//
// NOTE: destructive git operations (reset --hard / clean / checkout) live ONLY
// in longitudinal.mjs's run-reset path and are deliberately NOT exported here —
// keep the shared module read-only so an accidental import can't nuke a repo.
import { execFileSync } from 'node:child_process';

const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });

/** Current HEAD sha, or null on error. */
export function head(root) {
  try {
    return git(root, ['rev-parse', 'HEAD']).trim();
  } catch {
    return null;
  }
}

/** True if the working tree has any tracked/untracked change; null on error. */
export function dirty(root) {
  try {
    return git(root, ['status', '--porcelain']).trim().length > 0;
  } catch {
    return null;
  }
}

/**
 * Fingerprint the working tree (`status --porcelain`); null on error. Detects
 * changes a run made even when it didn't COMMIT (HEAD unchanged) — the run-2/3
 * finding where HEAD-only detection reported "repo changed: false" while the
 * team had modified src files + added tests in the working tree.
 */
export function statusFingerprint(root) {
  try {
    return git(root, ['status', '--porcelain']).trim();
  } catch {
    return null;
  }
}
