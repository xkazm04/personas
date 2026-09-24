/**
 * The bench gives the view back.
 *
 * `Esc` out of the bench must land the reader exactly where they were, which
 * is a promise about a value React never holds: the camera is tweened per
 * frame inside the engine. The store therefore asks the ENGINE for it on the
 * way up and hands it back on the way down. This pins the contract at the
 * store, with a stand-in engine that records what it was told; the pixel
 * proof (camera before == camera after, in a real browser) is in the
 * screenshot harness and reported beside it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';

import { overlayWithFixtureDecisions, useCouncilStore } from '../councilStore';
import type { CameraState, GalaxyFocus } from '../galaxy/engine/types';

function fakeEngine(camera: CameraState) {
  const calls: { focus: GalaxyFocus[]; restored: CameraState[]; benchHeight: number[] } = {
    focus: [],
    restored: [],
    benchHeight: [],
  };
  const engine = {
    getCamera: () => ({ ...camera }),
    setFocus: (focus: GalaxyFocus, fly?: boolean) => {
      // The bench must hand the focus back WITHOUT a flight, or the engine
      // would fly to that focus's own altitude and overwrite the camera.
      expect(fly).toBe(false);
      calls.focus.push(focus);
    },
    restoreCamera: (c: CameraState) => calls.restored.push(c),
    setBenchHeight: (px: number) => calls.benchHeight.push(px),
  };
  return { engine, calls };
}

const NODE_FOCUS: GalaxyFocus = {
  kind: 'node',
  domainSlug: 'software-engineering',
  categoryId: 'ui-surfaces',
  subjectSlug: 'table',
};

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
    runDir: null,
    finishedAt: null,
    decidedAt: null,
    rejectionReason: null,
    ...over,
  };
}

describe('the bench and the camera', () => {
  beforeEach(() => {
    useCouncilStore.setState({
      engine: null,
      benchOpen: false,
      focus: { kind: 'none' },
      focusBeforeBench: null,
      cameraBeforeBench: null,
      tableSubjectId: null,
      fixtureOn: false,
      fixtureDecisions: {},
    });
  });

  it('takes the camera from the engine on the way up, and gives it back on the way down', () => {
    const before: CameraState = { x: 1234.5, y: -987.25, k: 0.83125 };
    const { engine, calls } = fakeEngine(before);
    // The engine's real type carries the whole canvas surface; the stand-in
    // implements exactly the four methods the bench is allowed to use, which
    // is the point of the test.
    useCouncilStore.setState({
      engine: engine as unknown as NonNullable<ReturnType<typeof useCouncilStore.getState>['engine']>,
      focus: NODE_FOCUS,
    });

    useCouncilStore.getState().setBenchOpen(true);
    expect(useCouncilStore.getState().cameraBeforeBench).toEqual(before);
    expect(useCouncilStore.getState().focusBeforeBench).toBe(NODE_FOCUS);

    // the reader moves somewhere else entirely while the bench is up
    useCouncilStore.getState().focusCouncil(subject(), null);
    expect(useCouncilStore.getState().focus.kind).toBe('council');

    useCouncilStore.getState().setBenchOpen(false);
    expect(useCouncilStore.getState().focus).toBe(NODE_FOCUS);
    expect(calls.focus).toEqual([NODE_FOCUS]);
    expect(calls.restored).toEqual([before]);
    // Byte for byte, not approximately.
    expect(calls.restored[0]).toStrictEqual(before);
  });

  it('drops the bench without an engine rather than throwing', () => {
    useCouncilStore.setState({ focus: NODE_FOCUS });
    useCouncilStore.getState().setBenchOpen(true);
    expect(() => useCouncilStore.getState().setBenchOpen(false)).not.toThrow();
    expect(useCouncilStore.getState().benchOpen).toBe(false);
  });

  it('closes the round table when the bench drops', () => {
    useCouncilStore.setState({ tableSubjectId: 's1' });
    useCouncilStore.getState().setBenchOpen(false);
    expect(useCouncilStore.getState().tableSubjectId).toBeNull();
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
