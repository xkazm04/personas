import { describe, expect, it } from 'vitest';
import type { DispatchPreviewRow } from '@/lib/bindings/DispatchPreviewRow';
import { applyOrder } from '../useDispatchOrder';

function row(id: string, position: number): DispatchPreviewRow {
  return {
    personaId: id,
    personaName: id.toUpperCase(),
    personaIcon: null,
    personaColor: null,
    position,
    rank: null,
    wakePending: false,
    lastServedAt: null,
    intervalMinutes: 30,
    selfPaced: false,
    appMaster: false,
    charters: 1,
    verdict: { kind: 'idle' },
    lane: null,
  };
}

describe('applyOrder — a drag reorders the shown rows without losing anyone', () => {
  const rows = [row('a', 1), row('b', 2), row('c', 3), row('d', 4)];

  it('follows the named order and appends the unnamed in their old order', () => {
    expect(applyOrder(rows, ['c', 'a']).map((r) => r.personaId)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('ignores ids that are not on the board', () => {
    expect(applyOrder(rows, ['zzz', 'b']).map((r) => r.personaId)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('an empty order is the server order', () => {
    expect(applyOrder(rows, []).map((r) => r.personaId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('never duplicates a row named twice', () => {
    expect(applyOrder(rows, ['d', 'd', 'a']).map((r) => r.personaId)).toEqual(['d', 'a', 'b', 'c']);
  });
});
