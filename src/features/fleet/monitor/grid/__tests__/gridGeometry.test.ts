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
  columnRows, trayPerRow, boardPerRow, boardLayout, chunkRows,
  PERSONA_ROW_H, SESSION_ROW_H, DIVIDER_ROW_H, TRAY_ROW_H,
  NODE_W, TILE_W, TILE_H, SESSION_TILE_H, QUEUE_TILE_W, QUEUE_TILE_H, TITLE_ROW_H, SYMBOL_ROW_H,
  ROW_GAP, TRAY_GAP, BOARD_GAP, COLUMNS_PER_ROW, COLUMN_BODY_MAX_H,
  COLUMN_MIN_W, COLUMN_MAX_W, COLUMNS_PER_ROW_MAX,
} from '../gridGeometry';

const card = (id: string) => ({ personaId: id, personaName: id } as unknown as PersonaCardModel);
const session = (id: string) => ({ id, state: 'running' } as unknown as FleetSession);

describe('node geometry', () => {
  it('is ONE width for every node — the tile and queue names are the node', () => {
    expect(NODE_W).toBe(172);
    expect(TILE_W).toBe(NODE_W);
    expect(QUEUE_TILE_W).toBe(NODE_W);
  });

  it('keeps the NODE a constant while the board COLUMN became a runtime value', () => {
    // The board's columns now spread to fill their row (`boardLayout`), so how
    // wide a column is depends on a measurement and cannot be a constant. The
    // NODE's width still is one, and that is what protects everything that is
    // not the board: `QUEUE_TILE_W` aliases `NODE_W`, so widening the node to
    // widen the board would silently widen the runway and lane queues and
    // their ghosts. The ladder's floor is the node, never a replacement for it.
    expect(COLUMN_MIN_W).toBe(NODE_W);
    expect(boardLayout(3078).columnWidth).toBeGreaterThan(NODE_W);
    expect(QUEUE_TILE_W).toBe(NODE_W);
    // …and the queue's own wrap is unmoved by any of it.
    expect(boardPerRow(3078, QUEUE_TILE_W, 64)).toBe(16);
  });

  it('is two rows tall — title 20 + symbols 18 + padding — a session a little shorter than a persona', () => {
    expect(TITLE_ROW_H).toBe(20);
    expect(SYMBOL_ROW_H).toBe(18);
    expect(TILE_H).toBe(46);
    expect(SESSION_TILE_H).toBe(44);
    expect(TILE_H).toBe(TITLE_ROW_H + SYMBOL_ROW_H + 8);
    expect(SESSION_TILE_H).toBe(TITLE_ROW_H + SYMBOL_ROW_H + 6);
    expect(QUEUE_TILE_H).toBe(SESSION_TILE_H);
    expect(SESSION_TILE_H).toBeLessThan(TILE_H);
  });

  it('derives every row height from the node and its gap', () => {
    expect(PERSONA_ROW_H).toBe(TILE_H + ROW_GAP);
    expect(SESSION_ROW_H).toBe(SESSION_TILE_H + ROW_GAP);
    expect(TRAY_ROW_H).toBe(TILE_H + TRAY_GAP);
    expect(COLUMN_BODY_MAX_H).toBe(10 * PERSONA_ROW_H);
  });

  it('wraps the runway queue with the same arithmetic as the board, at the node width', () => {
    expect(boardPerRow(NODE_W * 3 + BOARD_GAP * 2, QUEUE_TILE_W, 64)).toBe(3);
    expect(boardPerRow(NODE_W * 12 + BOARD_GAP * 11, QUEUE_TILE_W, 64)).toBe(12);
    expect(boardPerRow(360 - 24, QUEUE_TILE_W, 64)).toBe(1);
  });
});

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

  it('carries the column\'s team name on every persona row, and null in the tray', () => {
    const named = columnRows([card('a')], [], 'pumper');
    expect(named[0]).toMatchObject({ kind: 'persona', teamName: 'pumper' });
    const tray = columnRows([card('a')], []);
    expect(tray[0]).toMatchObject({ kind: 'persona', teamName: null });
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

  it('is identical with its tileWidth defaulted and with the node passed explicitly', () => {
    // `tileWidth` exists so this cannot drift from `boardPerRow`, which has
    // taken one since the queue boards started measuring with their own tile.
    // The tray's caller keeps the default, so the two must agree everywhere.
    for (const w of [0, 10, 200, 360, 918, 1078, 1558, 3078]) {
      expect(trayPerRow(w)).toBe(trayPerRow(w, TILE_W));
    }
    // A different tile is a different wrap — the parameter is real, not decoration.
    expect(trayPerRow(TILE_W * 3 + TRAY_GAP * 2, 86)).toBe(5);
  });
});

describe('boardPerRow', () => {
  it('caps at five however wide the board is — it is a COUNT, and its callers want one', () => {
    // Still true of `boardPerRow` itself, which the runway queue calls with its
    // own tile width and a ceiling of 64 and which the board calls for its
    // pre-measurement count. The board's MEASURED count is `boardLayout`'s,
    // and that one goes to ten.
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

describe('boardLayout — the width ladder', () => {
  // The measured ladder, board width -> [perRow, columnWidth]. The first two
  // widths are the usable board on a 1280 and a 1440 window with the rail at
  // its 320px default; the rest are 1600 / 1920 / 2200 / 2560 / 3440.
  const LADDER: [number, number, number][] = [
    [918, 5, 174],
    [1078, 5, 206],
    [1238, 6, 196],
    [1558, 8, 184],
    [1838, 10, 173],
    [2198, 10, 209],
    [3078, 10, 280],
  ];

  it.each(LADDER)('spreads a %ipx board into %i columns of %ipx', (width, perRow, columnWidth) => {
    expect(boardLayout(width)).toEqual({ perRow, columnWidth });
  });

  it('never makes a column narrower than the node, so it can only improve on the fixed board', () => {
    // The old board painted every column at `NODE_W` and let a too-narrow board
    // scroll sideways. The ladder keeps that floor: below one node the lower
    // clamp holds, and the board scrolls exactly as it did before.
    for (let width = 1; width <= 4000; width += 1) {
      expect(boardLayout(width).columnWidth).toBeGreaterThanOrEqual(COLUMN_MIN_W);
    }
    expect(boardLayout(10)).toEqual({ perRow: 1, columnWidth: COLUMN_MIN_W });
    expect(boardLayout(COLUMN_MIN_W - 1)).toEqual({ perRow: 1, columnWidth: COLUMN_MIN_W });
  });

  it('stops widening at the ceiling and leaves the slack at the right edge', () => {
    // An ultra-wide board must not produce enormous tiles with a title row
    // swimming in empty space; past the ceiling the slack is honest.
    expect(boardLayout(3078).columnWidth).toBe(COLUMN_MAX_W);
    expect(boardLayout(100_000).columnWidth).toBe(COLUMN_MAX_W);
    for (let width = 1; width <= 4000; width += 1) {
      expect(boardLayout(width).columnWidth).toBeLessThanOrEqual(COLUMN_MAX_W);
    }
  });

  it('admits at most ten columns, however wide the board is', () => {
    expect(boardLayout(1838).perRow).toBe(COLUMNS_PER_ROW_MAX);
    expect(boardLayout(100_000).perRow).toBe(COLUMNS_PER_ROW_MAX);
    for (let width = 1; width <= 4000; width += 1) {
      const { perRow } = boardLayout(width);
      expect(perRow).toBeGreaterThanOrEqual(1);
      expect(perRow).toBeLessThanOrEqual(COLUMNS_PER_ROW_MAX);
    }
  });

  it('is optimistic before the first measurement, at the count boardPerRow assumes', () => {
    // The ghost paints from this same pair, and a first paint that opened at
    // TEN columns and reflowed to five would be a worse opening than the brief
    // overflow the optimistic count exists to prevent.
    expect(boardLayout(0)).toEqual({ perRow: COLUMNS_PER_ROW, columnWidth: COLUMN_MIN_W });
    expect(boardLayout(-24)).toEqual({ perRow: COLUMNS_PER_ROW, columnWidth: COLUMN_MIN_W });
    expect(boardLayout(0).perRow).toBe(boardPerRow(0));
  });

  it('packs the row before it spreads it — a column narrows when a new one is admitted', () => {
    // The sawtooth is inherent to packing at a minimum width. It is accepted,
    // not a bug to smooth: the alternative is columns that stop at a round
    // number and leave the slack in the middle of the board.
    // 1092 is where a sixth column first fits: 6 * 172 + 5 * 12.
    const admits = boardLayout(1092);
    const before = boardLayout(1091);
    expect(before).toEqual({ perRow: 5, columnWidth: 208 });
    expect(admits).toEqual({ perRow: 6, columnWidth: COLUMN_MIN_W });
    expect(admits.perRow).toBe(before.perRow + 1);
    expect(admits.columnWidth).toBeLessThan(before.columnWidth);
    // …and it grows again from there, up to the next admission.
    expect(boardLayout(1238).columnWidth).toBe(196);
    expect(boardLayout(1238).columnWidth).toBeGreaterThan(admits.columnWidth);
  });

  it('never overflows the width it was given', () => {
    for (let width = COLUMN_MIN_W; width <= 4000; width += 1) {
      const { perRow, columnWidth } = boardLayout(width);
      expect(perRow * columnWidth + (perRow - 1) * BOARD_GAP).toBeLessThanOrEqual(width);
    }
  });

  it('is a function of the ROW CAPACITY, not of how many teams exist', () => {
    // A three-team board shows three columns at the ladder width and leaves the
    // rest of the row empty. It does not stretch three columns across an
    // ultra-wide display, which would make a small fleet look like a full one.
    expect(boardLayout(3078).columnWidth).toBe(COLUMN_MAX_W);
    expect(chunkRows(['a', 'b', 'c'], boardLayout(3078).perRow)).toEqual([['a', 'b', 'c']]);
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
