import { describe, expect, it } from 'vitest';

import { seatWinRates, wilsonInterval } from '../stats';

const decided = (seatSpecs: string[], winnerSeatSpec: string | null) => ({ phase: 'decided', seatSpecs, winnerSeatSpec });

describe('seatWinRates', () => {
  it('counts only decided contests', () => {
    const board = seatWinRates([
      decided(['a', 'b'], 'a'),
      { phase: 'review', seatSpecs: ['a', 'b'], winnerSeatSpec: null },
      { phase: 'shortlisted', seatSpecs: ['a'], winnerSeatSpec: null },
    ]);
    expect(board.decided).toBe(1);
    expect(board.rows.map((r) => [r.spec, r.entered, r.wins])).toEqual([
      ['a', 1, 1],
      ['b', 1, 0],
    ]);
  });

  it('attaches the Wilson interval to each row', () => {
    const board = seatWinRates([decided(['a', 'b'], 'a'), decided(['a', 'b'], 'b'), decided(['a'], 'a')]);
    const a = board.rows.find((r) => r.spec === 'a')!;
    expect(a).toMatchObject({ entered: 3, wins: 2, ...wilsonInterval(2, 3) });
  });

  it('a spec listed twice in one contest enters once', () => {
    const board = seatWinRates([decided(['a', 'a'], 'a')]);
    expect(board.rows[0]).toMatchObject({ spec: 'a', entered: 1, wins: 1 });
  });

  it('orders by wins, then by the lower bound (more evidence first)', () => {
    const many = Array.from({ length: 6 }, () => decided(['x', 'y'], 'x'));
    const board = seatWinRates([...many, decided(['z'], 'z'), decided(['y'], null)]);
    expect(board.rows.map((r) => r.spec)).toEqual(['x', 'z', 'y']);
  });

  it('is not separated on thin evidence, separated on a clear lead', () => {
    expect(seatWinRates([decided(['a', 'b'], 'a')]).separated).toBe(false);
    const lead = Array.from({ length: 20 }, () => decided(['a', 'b'], 'a'));
    expect(seatWinRates(lead).separated).toBe(true);
  });

  it('an empty ledger has no rows', () => {
    expect(seatWinRates([])).toEqual({ rows: [], separated: true, decided: 0 });
  });
});
