// The seven-stage rail: where a contest stands in the pipeline, derived from
// the backend's ONE phase (Rust `derive_phase`) — the rail never re-derives
// a phase, it only lays the phase out along the pipeline.
//
// Brief · Seats · Run · Collect · Judge · Review · Decide
import type { ContestChainStep } from '@/lib/bindings/ContestChainStep';
import type { ContestPhase } from '@/lib/bindings/ContestPhase';

export const LEDGER_STAGES = ['brief', 'seats', 'run', 'collect', 'judge', 'review', 'decide'] as const;
export type LedgerStage = (typeof LEDGER_STAGES)[number];

/**
 * - done: finished
 * - current: the contest is here now (see `activity`)
 * - todo: not reached
 * - failed: the contest stopped here
 * - skipped: judges were off
 * - passed: behind the contest, but whether it ran is unknown (the judge
 *   stage seen from a summary, which does not carry `judgesEnabled`)
 */
export type StageState = 'done' | 'current' | 'todo' | 'failed' | 'skipped' | 'passed';

/** What "current" means: waiting for the operator, queued, working, or
 *  waiting on the owner's eyes. */
export type StageActivity = 'idle' | 'queued' | 'working' | 'attention' | null;

export interface StageCell {
  stage: LedgerStage;
  state: StageState;
}

export interface StageRailModel {
  cells: StageCell[];
  /** The stage the contest is at (the failed one, or the last when decided). */
  at: LedgerStage;
  activity: StageActivity;
  /** True once a decision (winner or refine) closed the contest. */
  closed: boolean;
}

export interface StageRailInput {
  phase: ContestPhase;
  /** From the detail; unknown on a summary row. */
  judgesEnabled?: boolean | null;
  /** From the detail; says whether a failure happened in the chain. */
  chainStep?: ContestChainStep | null;
}

const IDX: Record<LedgerStage, number> = {
  brief: 0,
  seats: 1,
  run: 2,
  collect: 3,
  judge: 4,
  review: 5,
  decide: 6,
};

function atOf(phase: ContestPhase, chainStep: ContestChainStep | null | undefined): LedgerStage {
  switch (phase) {
    case 'draft':
    case 'queued':
    case 'running':
      return 'run';
    case 'collecting':
      return 'collect';
    case 'judging':
      return 'judge';
    case 'review':
      return 'review';
    case 'shortlisted':
    case 'decided':
      return 'decide';
    case 'failed':
      // The chain records no failed step; a failed chain stopped after the
      // seats, so the failure sits at Collect (collect is the chain's entry).
      return chainStep === 'failed' ? 'collect' : 'run';
    default:
      return 'run';
  }
}

function activityOf(phase: ContestPhase): StageActivity {
  switch (phase) {
    case 'draft':
      return 'idle';
    case 'queued':
      return 'queued';
    case 'running':
    case 'collecting':
    case 'judging':
      return 'working';
    case 'review':
      return 'attention';
    default:
      return null;
  }
}

export function stageRail({ phase, judgesEnabled = null, chainStep = null }: StageRailInput): StageRailModel {
  const at = atOf(phase, chainStep);
  const atIdx = IDX[at];
  const closed = phase === 'decided' || phase === 'shortlisted';
  const failed = phase === 'failed';

  const cells = LEDGER_STAGES.map((stage): StageCell => {
    const i = IDX[stage];
    let state: StageState;
    if (closed) state = 'done';
    else if (i < atIdx) state = 'done';
    else if (i === atIdx) state = failed ? 'failed' : 'current';
    else state = 'todo';

    // The judge stage when judges are off, or unknown, once the contest is past it.
    if (stage === 'judge' && (state === 'done' || (closed && i <= atIdx))) {
      if (judgesEnabled === false) state = 'skipped';
      else if (judgesEnabled === null) state = 'passed';
    }
    if (stage === 'judge' && state === 'todo' && judgesEnabled === false) state = 'skipped';
    return { stage, state };
  });

  return { cells, at, activity: failed || closed ? null : activityOf(phase), closed };
}
