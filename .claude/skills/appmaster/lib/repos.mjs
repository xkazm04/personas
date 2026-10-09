// Multi-repo runs. Some masters work in a second repo: personas-web also changes the Personas desktop,
// and the game masters forge into the knowledge registry. The brief names those repos in `repos`
// ({key, root, baseBranch, lane?, gates?}); the project's own checkout is the implicit key `self`; a
// dispatch picks one with `repo` (default self). run.json records repo, repoRoot and repoBase at
// decide, and every git step after that (worktree, gates, rebase, merge, dirty overlap) uses THAT
// repo (contract.mjs repoOf). Heartbeat and outbox stay keyed by the PROJECT.
//
// Two invariants hold across ALL projects, keyed by the target repo ROOT (two projects writing the
// registry must not collide): declared paths stay disjoint, and a repo lane caps how many live runs
// one shared repo carries at once (REPO_LANES, tightened by a brief's `lane`).

import { LIVE_RUN_STATES, REPO_LANES, SELF_REPO, normRoot } from './contract.mjs';
import { listRuns, listSlugs, loadBrief } from './store.mjs';

/** The brief's repos entries that carry a key (validation is onboard's; this only reads). */
export const briefRepos = (brief) => (Array.isArray(brief?.repos) ? brief.repos.filter((r) => r && typeof r === 'object' && typeof r.key === 'string') : []);
/** Every key a dispatch may name for this brief: self first. */
export const repoKeys = (brief) => [SELF_REPO, ...briefRepos(brief).map((r) => r.key)];

/** (project, brief, key?) => {repo, repoRoot, repoBase}, or null for a key the brief does not name. */
export function resolveRepo(project, brief, key) {
  const k = key ?? SELF_REPO;
  if (k === SELF_REPO) return { repo: SELF_REPO, repoRoot: project.root, repoBase: project.baseBranch };
  const e = briefRepos(brief).find((r) => r.key === k);
  return e ? { repo: k, repoRoot: e.root, repoBase: e.baseBranch } : null;
}

/** The root a dispatch entry targets, for comparing two entries of one decision ('self' stands for the project's). */
export function targetRootKey(brief, key) {
  const k = key ?? SELF_REPO;
  if (k === SELF_REPO) return SELF_REPO;
  const e = briefRepos(brief).find((r) => r.key === k);
  return e ? normRoot(e.root) : `?${k}`;
}

/**
 * The lane cap for a repo root: the strictest of REPO_LANES and every managed brief's `lane` for that
 * root (a brief can tighten a contract lane, never loosen it). null = no lane: only paths decide.
 */
export function laneFor(root) {
  const k = normRoot(root);
  const caps = [];
  if (REPO_LANES[k] != null) caps.push(REPO_LANES[k]);
  for (const s of listSlugs()) {
    for (const e of briefRepos(loadBrief(s))) {
      if (e.root && normRoot(e.root) === k && Number.isInteger(e.lane) && e.lane > 0) caps.push(e.lane);
    }
  }
  return caps.length ? Math.min(...caps) : null;
}

/**
 * Runs that hold a repo now, in every managed project (plus `extraSlugs`): running, exited, verifying,
 * and planned once it has a worktree (a dispatch that crashed after the spawn may have a live builder).
 * A never-started planned run (decided, or queued) holds nothing.
 */
export function runsHoldingRepos(exceptRunId, extraSlugs = []) {
  const slugs = [...new Set([...listSlugs(), ...extraSlugs])];
  return slugs.flatMap((s) => listRuns(s, { states: LIVE_RUN_STATES }))
    .filter((r) => r.runId !== exceptRunId && (r.state !== 'planned' || r.worktree));
}
