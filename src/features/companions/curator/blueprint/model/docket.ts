/**
 * The docket's own vocabulary - the decisions Curator brings to a person.
 *
 * THERE IS NO PRODUCER YET. `curator_decision` has no writer in the shipped
 * packages and `curator_decisions_list` does not exist, which the commands
 * module says in as many words: "a door with neither a caller nor a producer
 * is dead surface twice over". So the page is wired to receive entries and
 * ships with none, and the drawer draws an honest empty state rather than a
 * zero - the same rule the ledger applies to the corpus, applied to itself.
 *
 * These types are the contract the package that raises the first decision
 * fills. They are deliberately the shape the design was drawn against, so that
 * package has a target rather than a blank page.
 */
import type { CuratorDecisionLevel } from '@/lib/bindings/CuratorDecisionLevel';

/** What a decision is ABOUT. Decides which figure the card draws. */
export type DocketKind =
  | 'subject_delta'
  | 'coverage_delta'
  | 'first_commit_consent'
  | 'subject_proposal'
  | 'stale_verdicts'
  | 'decline_ratified'
  | 'coverage_gap'
  | 'direction_proposal';

export interface SubjectSnapshot {
  techniques: number;
  applications: number;
  stacks: number;
  points: number;
  /** The scan's own sentences, so the mini-ledger draws the real marks. */
  reasons: string[];
}

export interface CoverageSnapshot {
  pairs: number;
  evaluated: number;
  deviations: number;
  staleVerdicts: number;
}

export interface StaleSample {
  context: string;
  subject: string;
  judged: string;
  revisionsBehind: number;
}

/** The figure a card draws. One arm per kind; nothing is drawn twice. */
export type DocketDrawing =
  | { kind: 'subject_delta'; before: SubjectSnapshot; after: SubjectSnapshot; branch: string }
  | { kind: 'coverage_delta'; project: string; before: CoverageSnapshot; after: CoverageSnapshot }
  | { kind: 'first_commit_consent'; project: string; paths: string[]; detail: string }
  | { kind: 'subject_proposal'; measuredGap: string; artifact: string; raisedBy: string; lo: number; hi: number; workers: number }
  | { kind: 'stale_verdicts'; stale: number; ofEvaluated: number; sample: StaleSample[] }
  | { kind: 'decline_ratified'; notes: number; each: number; detail: string }
  | { kind: 'coverage_gap'; gap: string; nearestStandIn: string; note: string }
  | { kind: 'direction_proposal'; technique: string; subject: string; project: string; raisedBy: string };

/**
 * One entry in the drawer. `answeredBy` is what separates the two raised
 * forms: null means it is WAITING for a person and renders as a raised card
 * with armed keys; a standing grant's name means it was answered at the gate
 * and renders as a receipt - you get the record, not the question.
 */
export interface DocketEntry {
  id: string;
  kind: DocketKind;
  title: string;
  level: CuratorDecisionLevel;
  raisedAt: string;
  /** What the card asks, in the registry's own words. */
  whatItAsks: string;
  options: string[];
  answeredBy: string | null;
  /** Why this level answers it the way it does. */
  why: string | null;
  commit: { repo: string; branch: string; sha: string; files: string[] } | null;
  drawing: DocketDrawing | null;
  /** The subject this card is about, so selecting it can light its ledger row. */
  subjectId: string | null;
}

/** A decision that is already settled: flat ledger lines, no card at all. */
export interface DocketSettled {
  id: string;
  title: string;
  decidedAt: string;
  decision: string;
  by: string;
  detail: string | null;
  /** A disagreement the record itself carries, never hidden in prose. */
  warning: string | null;
}

export interface DocketFeed {
  entries: DocketEntry[];
  settled: DocketSettled[];
}

export const EMPTY_DOCKET: DocketFeed = { entries: [], settled: [] };

/** An option whose answer is not usable without a reason written beside it. */
const REASON_REQUIRED = new Set([
  'Send back',
  'Park',
  'Decline',
  'Leave',
  'Revert',
  'Never here',
  'Stand-in is enough',
]);

export function needsReason(option: string): boolean {
  return REASON_REQUIRED.has(option);
}
