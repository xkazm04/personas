// Contest — the in-app home of the /contest method
// (`src-tauri/src/commands/contest/`).
//
// A contest is keyed by (projectId, contestId). The arena folders on disk are
// the single truth shared with the CLI skill; these calls read projections of
// them and drive the file steps through the skill's own `contest.mjs`.
// `contest-changed` announces every seat-state change and chain step, so a
// caller refetches on the event rather than polling.

import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { ContestBriefDraft } from '@/lib/bindings/ContestBriefDraft';
import type { ContestCreateRequest } from '@/lib/bindings/ContestCreateRequest';
import type { ContestDecision } from '@/lib/bindings/ContestDecision';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestEnvironment } from '@/lib/bindings/ContestEnvironment';
import type { ContestLineup } from '@/lib/bindings/ContestLineup';
import type { ContestReview } from '@/lib/bindings/ContestReview';
import type { ContestSeatKind } from '@/lib/bindings/ContestSeatKind';
import type { ContestStep } from '@/lib/bindings/ContestStep';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

/** `create` and `decide` shell out to node (`contest.mjs init` / `verdict` / `refine`). */
const NODE_STEP_TIMEOUT_MS = 120_000;
/** The Athena brief draft is one metered LLM call. */
const DRAFT_TIMEOUT_MS = 180_000;
/** A chain step can run the visual pass or a judge aggregate. */
const RUN_STEP_TIMEOUT_MS = 600_000;

/** Every contest across every managed dev project. */
export const listContests = () => invoke<ContestSummary[]>('contest_list');

/** One contest in full: seats, variants, scoreboard, review and chain state. */
export const getContest = (projectId: string, contestId: string) =>
  invoke<ContestDetail>('contest_get', { projectId, contestId });

/** Create a contest arena (and launch it when `req.launch`). */
export const createContest = (req: ContestCreateRequest) =>
  invoke<ContestSummary>('contest_create', { req }, { timeoutMs: NODE_STEP_TIMEOUT_MS });

/**
 * Queue the contest's seats of `kind` through the fleet. `only` limits the
 * launch to those seat ids (a retry); omit it to launch every seat of the kind.
 */
export const launchContest = (
  projectId: string,
  contestId: string,
  kind: ContestSeatKind,
  only?: string[] | null,
) => invoke<null>('contest_launch', { projectId, contestId, kind, only: only ?? null });

/** Cancel the contest's queued and running seats. */
export const cancelContest = (projectId: string, contestId: string) =>
  invoke<null>('contest_cancel', { projectId, contestId });

/** Persist the owner's review; `REVIEW.md` is re-rendered from it. */
export const saveContestReview = (projectId: string, contestId: string, review: ContestReview) =>
  invoke<null>('contest_save_review', { projectId, contestId, review });

/** Record the owner's decision. A shortlist returns the refine round's summary. */
export const decideContest = (projectId: string, contestId: string, decision: ContestDecision) =>
  invoke<ContestSummary>(
    'contest_decide',
    { projectId, contestId, decision },
    { timeoutMs: NODE_STEP_TIMEOUT_MS },
  );

/** Run (or retry) one autopilot chain step. */
export const runContestStep = (projectId: string, contestId: string, step: ContestStep) =>
  invoke<null>(
    'contest_run_step',
    { projectId, contestId, step },
    { timeoutMs: RUN_STEP_TIMEOUT_MS },
  );

/** Readiness probe: node, the instrument, the engine CLIs and Playwright. */
export const getContestEnvironment = (projectId: string) =>
  invoke<ContestEnvironment>('contest_environment', { projectId });

/** The saved seat line-ups. */
export const getContestLineups = () => invoke<ContestLineup[]>('contest_lineups_get');

/** Replace the saved seat line-ups. */
export const setContestLineups = (lineups: ContestLineup[]) =>
  invoke<null>('contest_lineups_set', { lineups });

/** Draft a five-section brief from a one-line idea with Athena (experimental). */
export const draftContestBrief = (projectId: string, idea: string) =>
  invoke<ContestBriefDraft>(
    'contest_draft_brief',
    { projectId, idea },
    { timeoutMs: DRAFT_TIMEOUT_MS },
  );
