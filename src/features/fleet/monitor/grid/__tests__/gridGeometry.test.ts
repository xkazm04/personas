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
  columnRows, trayPerRow, PERSONA_ROW_H, SESSION_ROW_H, DIVIDER_ROW_H,
  TILE_W, TRAY_GAP,
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
