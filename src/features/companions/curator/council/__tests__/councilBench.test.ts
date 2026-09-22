// The rules the bench and the gate rest on, one test each. Every one of
// these is a rule the reference artifact states in prose and that three
// separate surfaces have to agree about.
import { describe, expect, it } from 'vitest';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';

import { decidable, decidableCount } from '../councilRules';
import { effectiveSubject, queueFlat, queueGroups } from '../bench/queueModel';
import { gateOf, whyLine } from '../table/councilCopy';
import { FEATURE_V1 } from '../table/rubrics';
import { seatsOf } from '../table/runModel';

// The percent formatter the page hands these functions, stood in for here
// by the locale-aware one rather than a hand-rolled template.
const pct = (r: number) => new Intl.NumberFormat('en', { style: 'percent' }).format(r);

function subject(over: Partial<CouncilSubjectState>): CouncilSubjectState {
  return {
    id: 's1',
    projectId: 'p1',
    kind: 'use_case',
    useCaseId: 'u1',
    slug: 'slug',
    title: 'A feature',
    state: 'ready',
    tier: 'major',
    roundNo: 1,
    latestRunId: 'r1',
    outcome: 'ready',
    overall: 0.71,
    coverage: 1,
    trustState: 'uncalibrated',
    floorHits: 0,
    hardFailures: 0,
    drift: 'none',
    projectName: 'personas',
    registrySubjects: ['a'],
    runDir: null,
    finishedAt: null,
    decidedAt: null,
    rejectionReason: null,
    ...over,
  };
}

describe('only a decidable subject opens the gate', () => {
  it('opens for ready + major', () => {
    expect(gateOf(subject({}), FEATURE_V1, pct).open).toBe(true);
  });

  it('opens for an architecture redesign whatever its tier', () => {
    expect(gateOf(subject({ kind: 'architecture', tier: null }), FEATURE_V1, pct).open).toBe(true);
  });

  it('stays closed for ready + standard, and says which', () => {
    const gate = gateOf(subject({ tier: 'standard' }), FEATURE_V1, pct);
    expect(gate.open).toBe(false);
    expect(gate.key).toBe('why_ready_standard');
  });

  it.each([
    ['machine_pass', 'why_machine_pass'],
    ['stalled', 'why_stalled'],
    ['incomplete', 'why_incomplete'],
    ['fail', 'why_fail'],
    ['approved', 'why_approved'],
    ['approved_drifted', 'why_approved_drifted'],
    ['rejected', 'why_rejected'],
    ['none', 'why_none'],
  ])('closes on %s with exactly one sentence (%s)', (state, key) => {
    const gate = gateOf(subject({ state, tier: 'standard' }), FEATURE_V1, pct);
    expect(gate.open).toBe(false);
    expect(gate.key).toBe(key);
  });

  it('closes on a state this build has never heard of', () => {
    expect(gateOf(subject({ state: 'invented' }), FEATURE_V1, pct).open).toBe(false);
  });
});

describe('a machine pass is not waiting on anybody', () => {
  it('is excluded from the headline count', () => {
    const rows = [subject({ id: 'a' }), subject({ id: 'b', state: 'machine_pass', tier: 'standard' })];
    expect(decidableCount(rows)).toBe(1);
  });

  it('sits under "not waiting on you", not under "yours"', () => {
    const rows = [subject({ id: 'b', state: 'machine_pass', tier: 'standard' })];
    const groups = queueGroups(rows);
    expect(groups[0].rows).toHaveLength(0);
    expect(groups[1].rows.map((r) => r.id)).toEqual(['b']);
  });
});

describe('the queue', () => {
  it('orders what is yours by hard failures, then floors, then coverage', () => {
    const rows = [
      subject({ id: 'thin', coverage: 0.7, title: 'C' }),
      subject({ id: 'floored', floorHits: 1, title: 'B' }),
      subject({ id: 'hard', hardFailures: 1, title: 'A' }),
      subject({ id: 'clean', title: 'D' }),
    ];
    expect(queueGroups(rows)[0].rows.map((r) => r.id)).toEqual(['hard', 'floored', 'thin', 'clean']);
  });

  it('moves a decided subject into Decided, where the bench shows it', () => {
    const rows = [subject({ id: 'a' })];
    expect(queueGroups(rows)[0].rows.map((r) => r.id)).toEqual(['a']);
    const after = rows.map((r) =>
      effectiveSubject(r, { a: { decision: 'approved', reason: null } }),
    );
    const groups = queueGroups(after);
    expect(groups[0].rows).toHaveLength(0);
    expect(groups[2].rows.map((r) => r.id)).toEqual(['a']);
    expect(decidableCount(after)).toBe(0);
    expect(queueFlat(groups)).toHaveLength(1);
  });

  it('carries a rejection reason back onto the row', () => {
    const after = effectiveSubject(subject({ id: 'a' }), {
      a: { decision: 'rejected', reason: 'the migration has no down path' },
    });
    expect(after.state).toBe('rejected');
    expect(after.rejectionReason).toBe('the migration has no down path');
    expect(decidable(after)).toBe(false);
  });
});

describe('a null score is never a zero', () => {
  it('leaves the seat unmeasured, so the rose hatches it at full reach', () => {
    const seats = seatsOf({ rubricVersion: 'feature-v1' }, 'use_case', []);
    expect(seats).toHaveLength(5);
    expect(seats.every((s) => s.score === null)).toBe(true);
  });

  it('reads as "no overall" rather than as a failure to clear the threshold', () => {
    const seats = seatsOf({ rubricVersion: 'feature-v1' }, 'use_case', []);
    expect(whyLine(seats, null, 0.2, FEATURE_V1, pct).key).toBe('why_no_overall');
  });
});
