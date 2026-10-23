/**
 * The deck's `lane` scope and the lane buttons (mandate-lanes WP4):
 *  - a lane deck deals only that lane's items, in lane order, and an emptied
 *    lane offers the other lanes still holding cards;
 *  - the lane strip prints each lane's key, and a failed source shows the
 *    failed mark with the source named, never a 0;
 *  - `1`-`4` / `O` map to the lanes.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { DecisionLanesSnapshot } from '@/lib/bindings/DecisionLanesSnapshot';

import { item } from '../../__tests__/rosterFixtures';
import { offersOf } from '../../deck/DeckModal';
import { queueOf } from '../../deck/useDeck';
import { LaneStrip } from '../../hub/lanes/LaneStrip';
import { buildLaneCounts, indexLanes } from '../laneModel';
import { laneForKey } from '../laneMeta';

vi.mock('@/hooks/utility/interaction/useMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/utility/interaction/useMotion')>()),
  useReducedMotion: () => true,
}));

const SNAP: DecisionLanesSnapshot = {
  items: [
    { itemId: 'review:a', itemKind: 'review', lane: 'breach', clause: 'unsigned', charterId: 'c1', coalesceKey: 'k', irreversible: null, projectId: 'p1' },
    { itemId: 'incident:b', itemKind: 'incident', lane: 'breach', clause: 'stop', charterId: 'c1', coalesceKey: 'k', irreversible: null, projectId: 'p1' },
    { itemId: 'report:c', itemKind: 'report', lane: 'accept', clause: 'none', charterId: 'c1', coalesceKey: 'k', irreversible: null, projectId: 'p1' },
  ],
  charters: [],
  failedSources: [],
  generatedAt: '2026-10-14T00:00:00Z',
};

describe('the lane scope', () => {
  const items = [
    item({ id: 'review:a', kind: 'review', createdAt: '2026-10-01T00:00:00Z' }),
    item({ id: 'incident:b', kind: 'incident', createdAt: '2026-10-09T00:00:00Z' }),
    item({ id: 'report:c', kind: 'report' }),
  ];
  const index = indexLanes(SNAP);

  it('deals only the lane, stop clause first', () => {
    expect(queueOf({ kind: 'lane', lane: 'breach' }, items, index).map((x) => x.id)).toEqual(['incident:b', 'review:a']);
    expect(queueOf({ kind: 'lane', lane: 'accept' }, items, index).map((x) => x.id)).toEqual(['report:c']);
    // Without the join a lane deals nothing rather than everything.
    expect(queueOf({ kind: 'lane', lane: 'breach' }, items)).toEqual([]);
  });

  it('an emptied lane offers the other lanes that hold cards', () => {
    const lc = buildLaneCounts({ snapshot: SNAP, snapshotFailed: false, questions: 0, chat: { n: 2, failed: false } });
    expect(offersOf({ kind: 'lane', lane: 'accept' }, undefined, lc)).toEqual([
      { lane: 'breach', n: 2 },
      { lane: 'talk', n: 2 },
    ]);
  });
});

describe('the lane strip', () => {
  const ready = { n: 0, lamp: 'neutral' as const, failed: false };
  const refs = { current: {} };

  it('names each key and counts each lane', () => {
    const lc = buildLaneCounts({ snapshot: SNAP, snapshotFailed: false, questions: 1, chat: { n: 0, failed: false } });
    render(<LaneStrip counts={lc} settled ready={ready} open={null} refs={refs} onLane={vi.fn()} onReady={vi.fn()} />);
    expect(screen.getByTestId('decision-lane-breach').getAttribute('data-count')).toBe('3');
    expect(screen.getByTestId('decision-lane-breach').getAttribute('aria-keyshortcuts')).toBe('1');
    expect(screen.getByTestId('decision-lane-orphan').getAttribute('aria-keyshortcuts')).toBe('O');
    expect(screen.getByTestId('decision-lane-talk').hasAttribute('data-zero')).toBe(true);
  });

  it('shows a failed source as failed, never 0, and names it', () => {
    const lc = buildLaneCounts({ snapshot: { ...SNAP, failedSources: ['reviews'] }, snapshotFailed: false, questions: 0, chat: { n: 0, failed: false } });
    render(<LaneStrip counts={lc} settled ready={ready} open={null} refs={refs} onLane={vi.fn()} onReady={vi.fn()} />);
    const breach = screen.getByTestId('decision-lane-breach');
    expect(breach.getAttribute('data-count')).toBe('failed');
    expect(breach.getAttribute('aria-label')).toContain('reviews');
    expect(screen.getByTestId('decision-lane-breach-failed')).toBeTruthy();
  });

  it('shows a ghost, not 0, before the first read settles', () => {
    const lc = buildLaneCounts({ snapshot: null, snapshotFailed: false, questions: 0, chat: { n: 0, failed: false } });
    render(<LaneStrip counts={lc} settled={false} ready={ready} open={null} refs={refs} onLane={vi.fn()} onReady={vi.fn()} />);
    expect(screen.getByTestId('decision-lane-sign').getAttribute('data-count')).toBe('pending');
  });
});

describe('lane keys', () => {
  it('maps 1-4 and O, nothing else', () => {
    expect(['1', '2', '3', '4', 'o', 'O', '5', 'm'].map(laneForKey)).toEqual([
      'breach', 'sign', 'accept', 'talk', 'orphan', 'orphan', null, null,
    ]);
  });
});
