// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { DecisionLanesSnapshot } from '@/lib/bindings/DecisionLanesSnapshot';
import type { LaneEntry } from '@/lib/bindings/LaneEntry';

import type { DecisionItem } from '../../model/decisionModel';
import {
  SNAPSHOT_SOURCE,
  buildLaneCounts,
  cardsByProject,
  chipsForLane,
  indexLanes,
  laneOfItem,
  laneQueue,
  laneTotal,
} from '../laneModel';

function entry(itemId: string, lane: LaneEntry['lane'], clause: LaneEntry['clause'] = 'none', extra: Partial<LaneEntry> = {}): LaneEntry {
  return {
    itemId,
    itemKind: itemId.split(':')[0]!,
    lane,
    clause,
    charterId: 'c1',
    coalesceKey: itemId,
    irreversible: null,
    projectId: 'p1',
    ...extra,
  };
}

function snap(items: LaneEntry[], failedSources: string[] = []): DecisionLanesSnapshot {
  return { items, charters: [], failedSources, generatedAt: '2026-10-14T00:00:00Z' };
}

function item(id: string, createdAt: string): DecisionItem {
  const kind = id.split(':')[0] as DecisionItem['kind'];
  return { id, kind, createdAt, weight: 0 } as unknown as DecisionItem;
}

describe('buildLaneCounts', () => {
  const s = snap([
    entry('review:1', 'breach', 'unsigned'),
    entry('incident:1', 'breach', 'stop'),
    entry('policy:1', 'orphan'),
    entry('report:1', 'accept'),
    entry('report:2', 'evidence'),
    entry('idea:1', 'held'),
    entry('mandate:c2', 'sign'),
  ]);

  it('counts the snapshot per lane and adds questions to Breach, chat to Talk', () => {
    const c = buildLaneCounts({ snapshot: s, snapshotFailed: false, questions: 2, chat: { n: 3, failed: false } });
    expect(c.breach.n).toBe(4);
    expect(c.sign.n).toBe(1);
    expect(c.accept.n).toBe(1);
    expect(c.talk.n).toBe(3);
    expect(c.orphan.n).toBe(1);
    // A stop clause lights Breach red.
    expect(c.breach.lamp).toBe('danger');
    // Held and evidence are never cards.
    expect(laneTotal(c)).toBe(9);
  });

  it('fails every snapshot-fed lane on a named source, never Talk', () => {
    const c = buildLaneCounts({ snapshot: snap([], ['reviews']), snapshotFailed: false, questions: 0, chat: { n: 0, failed: false } });
    for (const l of ['breach', 'sign', 'accept', 'orphan'] as const) {
      expect(c[l].failed).toBe(true);
      expect(c[l].failedSources).toEqual(['reviews']);
    }
    expect(c.talk.failed).toBe(false);
  });

  it('a failed read before any snapshot is failed, not zero', () => {
    const c = buildLaneCounts({ snapshot: null, snapshotFailed: true, questions: 0, chat: { n: 0, failed: false } });
    expect(c.breach.failed).toBe(true);
    expect(c.breach.failedSources).toEqual([SNAPSHOT_SOURCE]);
  });

  it('Talk fails with the chat derivation alone', () => {
    const c = buildLaneCounts({ snapshot: s, snapshotFailed: false, questions: 0, chat: { n: 0, failed: true } });
    expect(c.talk.failed).toBe(true);
    expect(c.breach.failed).toBe(false);
  });
});

describe('the join and the lane order', () => {
  const s = snap([
    entry('review:old', 'breach', 'unsigned'),
    entry('review:risk', 'breach', 'risk'),
    entry('incident:stop', 'breach', 'stop'),
    entry('report:1', 'accept'),
  ]);
  const index = indexLanes(s);
  const items = [
    item('review:old', '2026-10-01T00:00:00Z'),
    item('review:risk', '2026-10-10T00:00:00Z'),
    item('incident:stop', '2026-10-12T00:00:00Z'),
    item('question:q1', '2026-10-02T00:00:00Z'),
    item('message:m1', '2026-10-02T00:00:00Z'),
    item('report:1', '2026-10-02T00:00:00Z'),
    item('idea:unrouted', '2026-10-02T00:00:00Z'),
  ];

  it('joins on itemId and routes the frontend kinds itself', () => {
    expect(laneOfItem(items[0]!, index)).toEqual({ lane: 'breach', clause: 'unsigned' });
    expect(laneOfItem(items[3]!, index)).toEqual({ lane: 'breach', clause: 'unsigned' });
    expect(laneOfItem(items[4]!, index)).toEqual({ lane: 'talk', clause: 'none' });
    expect(laneOfItem(items[6]!, index)).toBeNull();
  });

  it('orders a lane by clause rank, then age', () => {
    expect(laneQueue('breach', items, index).map((i) => i.id)).toEqual([
      'incident:stop',
      'review:risk',
      'review:old',
      'question:q1',
    ]);
    expect(laneQueue('accept', items, index).map((i) => i.id)).toEqual(['report:1']);
  });

  it('loads only the chips a lane needs', () => {
    expect(chipsForLane('breach', s)).toEqual(['gates', 'incidents']);
    expect(chipsForLane('accept', s)).toEqual(['reports']);
    expect(chipsForLane('talk', s)).toEqual(['chat']);
    expect(chipsForLane('sign', null)).toHaveLength(7);
  });

  it('counts cards per project for the Bay lamp, only on a mandate and only in card lanes', () => {
    const m = cardsByProject(snap([
      entry('review:1', 'breach'),
      entry('report:1', 'accept'),
      entry('report:2', 'evidence'),
      entry('idea:1', 'orphan', 'none', { charterId: null, projectId: 'p2' }),
    ]));
    expect(m.get('p1')).toBe(2);
    expect(m.has('p2')).toBe(false);
  });
});
