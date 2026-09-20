// The sentences the council surface says about itself.
//
// Kept away from the components because all three of them - the queue
// preview, the round table and the gate - must say the SAME thing about the
// same subject. A gate whose one closed-sentence disagreed with the queue
// row above it would be the exact defect the shared `decidable()` predicate
// was written to prevent, one layer up.
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';

import { decidable } from '../councilRules';
import type { Rubric } from './rubrics';
import type { Seat } from './runModel';

export interface GateCopy {
  /** Translated strings this module interpolates, handed in by the caller. */
  open_body: string;
  why_ready_standard: string;
  why_machine_pass: string;
  why_stalled: string;
  why_incomplete: string;
  why_fail: string;
  why_approved: string;
  why_approved_drifted: string;
  why_rejected: string;
  why_none: string;
}

export interface Gate {
  open: boolean;
  /** The key the caller interpolates, plus the values it needs. */
  key: keyof GateCopy;
  values: Record<string, string | number>;
}

/**
 * Whether the gate opens, and the ONE sentence that says why when it does
 * not. Total over `CouncilState` with an explicit unknown arm.
 */
export function gateOf(
  subject: Pick<CouncilSubjectState, 'state' | 'tier' | 'kind' | 'roundNo' | 'coverage'>,
  rubric: Rubric,
  percent: (ratio: number) => string,
): Gate {
  if (decidable(subject)) return { open: true, key: 'open_body', values: {} };
  return { open: false, key: closedKey(subject), values: closedValues(subject, rubric, percent) };
}

function closedKey(
  subject: Pick<CouncilSubjectState, 'state' | 'tier' | 'kind'>,
): keyof GateCopy {
  switch (subject.state) {
    case 'ready':
      return 'why_ready_standard';
    case 'machine_pass':
      return 'why_machine_pass';
    case 'stalled':
      return 'why_stalled';
    case 'incomplete':
      return 'why_incomplete';
    case 'fail':
      return 'why_fail';
    case 'approved':
      return 'why_approved';
    case 'approved_drifted':
      return 'why_approved_drifted';
    case 'rejected':
      return 'why_rejected';
    case 'none':
      return 'why_none';
    default:
      // A state this build does not know is not silently "fine".
      return 'why_none';
  }
}

function closedValues(
  subject: Pick<CouncilSubjectState, 'roundNo' | 'coverage'>,
  rubric: Rubric,
  percent: (ratio: number) => string,
): Record<string, string | number> {
  return {
    round: subject.roundNo ?? 1,
    coverage: subject.coverage == null ? '-' : percent(subject.coverage),
    floor: percent(rubric.coverageFloor),
  };
}

/** Does the gate open for this subject? The one predicate, re-exported. */
export function gateOpens(
  subject: Pick<CouncilSubjectState, 'state' | 'tier' | 'kind'>,
): boolean {
  return decidable(subject);
}

export interface WhyLine {
  key: 'why_floor_hit' | 'why_clears' | 'why_under' | 'why_no_overall';
  values: Record<string, string | number>;
}

/**
 * The council's one-sentence reading of a round: what actually decided it.
 *
 * A floor hit is named first, because a floor hit is WHY the run stopped and
 * the overall beside it would be a distraction. With no floor hit the line
 * is the margin against the threshold, in either direction, so a run that
 * misses by 0.01 reads as a near miss rather than as a failure.
 */
export function whyLine(
  seats: Seat[],
  overall: number | null,
  coverage: number | null,
  rubric: Rubric,
  percent: (ratio: number) => string,
): WhyLine {
  const hit = seats.find((s) => s.floorHit);
  if (hit) {
    return {
      key: 'why_floor_hit',
      values: {
        member: hit.name,
        score: hit.score == null ? '-' : hit.score.toFixed(2),
        floor: hit.floor == null ? '-' : hit.floor.toFixed(2),
      },
    };
  }
  if (overall == null) {
    return {
      key: 'why_no_overall',
      values: {
        coverage: coverage == null ? '-' : percent(coverage),
        floor: percent(rubric.coverageFloor),
      },
    };
  }
  const measured = seats.filter((s) => s.score != null).length;
  const margin = overall - rubric.threshold;
  return {
    key: margin >= 0 ? 'why_clears' : 'why_under',
    values: {
      measured,
      total: seats.length,
      overall: overall.toFixed(2),
      threshold: rubric.threshold.toFixed(2),
      margin: Math.abs(margin).toFixed(2),
    },
  };
}
