// The board's virtualization arithmetic.
//
// These are the two decisions the virtualizers cannot make for themselves and
// cannot be checked from the running app: the load harness never binds a
// synthetic session to a TEAM, so the column path — and with it the
// `fleet-grid-session-strip` divider, which the tour-anchor manifest addresses
// — is only reachable here.

import { describe, it, expect } from 'vitest';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PersonaCardModel } from '../../monitorModel';
import {
  columnRows, trayPerRow, boardPerRow, chunkRows,
  PERSONA_ROW_H, SESSION_ROW_H, DIVIDER_ROW_H,
  TILE_W, TRAY_GAP, BOARD_GAP, COLUMNS_PER_ROW,
} from '../gridGeometry';

const card = (id: string) => ({ personaId: id, personaName: id } as unknown as PersonaCardModel);
const session = (id: string) => ({ id, state: 'running' } as unknown as FleetSession);

describe('columnRows', () => {
  it('emits no divider for a column with no live sessions', () => {
    const rows = columnRows([card('a'), card('b')], []);
    expect(rows.map((r) => r.kind)).toEqual(['persona', 'persona']);
  });

  it('separates the roster from the sessions with exactly one divider', () => {
    const rows = columnRows([card('a')], [session('s1'), session('s2')]);
    expect(rows.map((r) => r.kind)).toEqual(['persona', 'divider', 'session', 'session']);
  });

  it('gives every row a non-zero height, which the virtualizer positions from', () => {
    const rows = columnRows([card('a')], [session('s1')]);
    expect(rows.map((r) => r.height)).toEqual([PERSONA_ROW_H, DIVIDER_ROW_H, SESSION_ROW_H]);
    expect(rows.every((r) => r.height > 0)).toBe(true);
  });

  it('keys rows so a persona and a session of the same id cannot collide', () => {
    const rows = columnRows([card('x')], [session('x')]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('is stable in order — the roster always precedes the sessions', () => {
    const rows = columnRows([card('a'), card('b')], [session('s1')]);
    expect(rows.findIndex((r) => r.kind === 'divider'))
      .toBeGreaterThan(rows.findLastIndex((r) => r.kind === 'persona'));
  });
});

describe('trayPerRow', () => {
  it('wraps at the same point the flex-wrap box did', () => {
    // Three tiles plus the two gaps between them.
    expect(trayPerRow(TILE_W * 3 + TRAY_GAP * 2)).toBe(3);
    // One pixel short of a fourth tile is still three.
    expect(trayPerRow(TILE_W * 4 + TRAY_GAP * 3 - 1)).toBe(3);
    expect(trayPerRow(TILE_W * 4 + TRAY_GAP * 3)).toBe(4);
  });

  it('never returns zero — a zero would divide by zero into an infinite row count', () => {
    expect(trayPerRow(0)).toBe(1);
    expect(trayPerRow(-100)).toBe(1);
    expect(trayPerRow(10)).toBe(1);
  });
});

describe('boardPerRow', () => {
  it('caps at five however wide the board is', () => {
    expect(boardPerRow(TILE_W * 20)).toBe(COLUMNS_PER_ROW);
    expect(boardPerRow(100_000)).toBe(COLUMNS_PER_ROW);
  });

  it('takes the smaller of five and what actually fits', () => {
    expect(boardPerRow(TILE_W * 3 + BOARD_GAP * 2)).toBe(3);
    // One pixel short of a fourth column is still three.
    expect(boardPerRow(TILE_W * 4 + BOARD_GAP * 3 - 1)).toBe(3);
    expect(boardPerRow(TILE_W * 4 + BOARD_GAP * 3)).toBe(4);
  });

  it('assumes the full count before the first measurement', () => {
    // A one-column first paint that reflows to five is a worse opening than a
    // brief overflow, so an unmeasured board is optimistic, not pessimistic.
    expect(boardPerRow(0)).toBe(COLUMNS_PER_ROW);
    expect(boardPerRow(-24)).toBe(COLUMNS_PER_ROW);
  });

  it('never returns zero, however narrow', () => {
    expect(boardPerRow(10)).toBe(1);
    expect(boardPerRow(TILE_W - 1)).toBe(1);
  });
});

describe('chunkRows', () => {
  it('fills each row before starting the next, and keeps the order', () => {
    expect(chunkRows([1, 2, 3, 4, 5, 6, 7], 5)).toEqual([[1, 2, 3, 4, 5], [6, 7]]);
  });

  it('is one row when everything fits, and none when there is nothing', () => {
    expect(chunkRows([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
    expect(chunkRows([], 5)).toEqual([]);
  });

  it('cannot be made to loop forever by a zero row size', () => {
    expect(chunkRows([1, 2], 0)).toEqual([[1], [2]]);
  });
});
