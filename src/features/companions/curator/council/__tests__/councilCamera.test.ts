/**
 * The store's share of the queue and the open council, and of fixture
 * decisions.
 *
 * Selecting a council in the lanes lights its stars through the SAME council
 * focus the field already flies to, and opening one selects it, so the
 * header CTA, the lanes and the field can never disagree about which council
 * the reader means.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';

import { overlayWithFixtureDecisions, useCouncilStore } from '../councilStore';

function subject(over: Partial<CouncilSubjectState> = {}): CouncilSubjectState {
  return {
    id: 's1',
    projectId: 'p1',
    kind: 'use_case',
    useCaseId: null,
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
    registrySubjects: ['table', 'form'],
    dimensions: [],
    mustAddressCount: 0,
    reportPath: null,
    runDir: null,
    finishedAt: null,
    decidedAt: null,
    rejectionReason: null,
    ...over,
  };
}

describe('selecting and opening a council', () => {
  beforeEach(() => {
    useCouncilStore.setState({ focus: { kind: 'none' }, selectedId: null, openId: null });
  });

  it('lights the selected council through the council focus, and clears both together', () => {
    useCouncilStore.getState().selectCouncil(subject());
    const s = useCouncilStore.getState();
    expect(s.selectedId).toBe('s1');
    expect(s.focus).toEqual({ kind: 'council', subjectId: 's1', title: 'A feature', registrySubjects: ['table', 'form'] });

    useCouncilStore.getState().selectCouncil(null);
    expect(useCouncilStore.getState().selectedId).toBeNull();
    expect(useCouncilStore.getState().focus.kind).toBe('none');
  });

  it('selects what it opens, and keeps the selection when the council closes', () => {
    useCouncilStore.getState().openCouncil('s1');
    expect(useCouncilStore.getState()).toMatchObject({ openId: 's1', selectedId: 's1' });
    useCouncilStore.getState().openCouncil(null);
    expect(useCouncilStore.getState()).toMatchObject({ openId: null, selectedId: 's1' });
  });
});

describe('a fixture decision repaints the stars', () => {
  it('moves one count off pending and onto the decided side, per star', () => {
    const base = {
      subjects: [
        { slug: 'table', approved: 0, rejected: 0, pending: 1, techniquesProven: 2, projects: ['personas'], last: null },
      ],
    };
    const next = overlayWithFixtureDecisions(base, [subject()], {
      s1: { decision: 'rejected', reason: 'no down path' },
    });
    const rows = new Map((next?.subjects ?? []).map((r) => [r.slug, r]));
    expect(rows.get('table')).toMatchObject({ rejected: 1, pending: 0, approved: 0 });
    // A star the overlay had never heard of is added, not dropped.
    expect(rows.get('form')).toMatchObject({ rejected: 1, pending: 0 });
  });

  it('is the identity when nothing has been decided', () => {
    const base = { subjects: [] };
    expect(overlayWithFixtureDecisions(base, [subject()], {})).toBe(base);
  });

  it('leaves a subject it cannot resolve alone rather than inventing a star', () => {
    const next = overlayWithFixtureDecisions({ subjects: [] }, [], {
      gone: { decision: 'approved', reason: null },
    });
    expect(next?.subjects).toEqual([]);
  });
});

describe('the store never records a fixture decision with the fixture off', () => {
  it('ignores it', () => {
    const spy = vi.fn();
    useCouncilStore.setState({ fixtureOn: false });
    useCouncilStore.getState().recordFixtureDecision('s1', 'approved', null);
    expect(useCouncilStore.getState().fixtureDecisions).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });
});
