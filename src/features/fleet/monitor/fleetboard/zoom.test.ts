// The team zoom (L1): derived from the board, one level in the Escape chain.

import { describe, expect, it } from 'vitest';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaCardModel } from '../monitorModel';
import { buildBoard, zoomBoard } from './boardModel';
import { registerBoardBack, takeBoardBack } from './boardEscape';
import { layoutField } from './layout';
import { runAgeFraction } from './Tile';

function card(personaId: string, o: Partial<PersonaCardModel> = {}): PersonaCardModel {
  return {
    personaId, personaName: personaId, personaIcon: null, personaColor: null, enabled: true,
    reviews: [], reviewCounts: { critical: 0, warning: 0, info: 0 }, topReviewSeverity: null,
    reviewCount: 0, messages: [], messageCount: 0, processes: [],
    running: 0, queued: 0, inputRequired: 0, draftReady: 0, runningSince: null,
    execState: 'idle', attentionCount: 0,
    healthStatus: null, recentStatuses: [], successRate: null, runsToday: 0, totalRecent: 0,
    liveCostUsd: 0, liveToolCalls: 0,
    ...o,
  };
}

// Fixtures: only `id` / `home_team_id` / `name` are read by the grouping.
const team = (id: string) => ({ id, name: id.toUpperCase(), color: '#22d3ee', icon: null } as unknown as PersonaTeam);
const persona = (id: string, home_team_id: string | null) => ({ id, home_team_id } as unknown as Persona);

const board = buildBoard(
  [card('a', { messageCount: 2, runsToday: 4 }), card('b', { runsToday: 1 }), card('c', { execState: 'failed', runsToday: 2 })],
  [persona('a', 't1'), persona('b', 't1'), persona('c', 't2')],
  [team('t1'), team('t2')],
);

describe('zoomBoard', () => {
  it('narrows the field, the rail and the totals to one team', () => {
    const z = zoomBoard(board, 't1');
    expect(z.zoomed?.id).toBe('t1');
    expect(z.bays.map((b) => b.id)).toEqual(['t1']);
    expect(z.queue.map((c) => c.personaId)).toEqual(['a']);
    expect(z.totals).toMatchObject({ needs: 1, resting: 1, total: 2 });
    expect(z.runsToday).toBe(5);
  });

  it('reads a zoom on a team that is not on the board as the fleet (derived, not stored)', () => {
    for (const id of [null, 'gone']) {
      const z = zoomBoard(board, id);
      expect(z.zoomed).toBeNull();
      expect(z.bays).toBe(board.bays);
      expect(z.queue).toBe(board.queue);
    }
  });

  it('gives a small zoomed team large tiles, capped short of posters', () => {
    const [bay] = layoutField([{ id: 't1', count: 2 }], 1594, 808, { w: 380, h: 270 });
    expect(bay!.tier).toBe('large');
    expect(bay!.tiles[0]!.w).toBeLessThanOrEqual(380);
    expect(bay!.tiles[0]!.h).toBeLessThanOrEqual(270);
  });
});

describe('boardEscape', () => {
  it('consumes Escape only while the Board has a level to go back to', () => {
    expect(takeBoardBack()).toBe(false);
    let backs = 0;
    const unregister = registerBoardBack(() => { backs += 1; });
    expect(takeBoardBack()).toBe(true);
    expect(backs).toBe(1);
    unregister();
    expect(takeBoardBack()).toBe(false);
  });

  it('never lets a stale cleanup remove a newer registration', () => {
    const first = registerBoardBack(() => undefined);
    const second = registerBoardBack(() => undefined);
    first();
    expect(takeBoardBack()).toBe(true);
    second();
    expect(takeBoardBack()).toBe(false);
  });
});

describe('runAgeFraction', () => {
  const minute = 1_000_000;
  const since = (mins: number) => (minute - mins) * 60_000;
  it('draws nothing without a run or a clock, fills at four hours', () => {
    expect(runAgeFraction(null, minute)).toBe(0);
    expect(runAgeFraction(since(5), 0)).toBe(0);
    expect(runAgeFraction(since(240), minute)).toBeCloseTo(1);
    expect(runAgeFraction(since(600), minute)).toBe(1);
  });
  it('moves visibly in the first minutes and orders runs by age', () => {
    expect(runAgeFraction(since(5), minute)).toBeGreaterThan(0.25);
    expect(runAgeFraction(since(60), minute)).toBeGreaterThan(runAgeFraction(since(5), minute));
  });
});
