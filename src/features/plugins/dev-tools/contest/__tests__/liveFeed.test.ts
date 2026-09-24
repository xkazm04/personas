import { describe, expect, it } from 'vitest';

import type { ContestPhase } from '@/lib/bindings/ContestPhase';
import type { ContestSeatState } from '@/lib/bindings/ContestSeatState';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

import { createLiveFeedMemory, noticesFor, observePhase } from '../model/liveFeed';

const summary = (phase: ContestPhase): ContestSummary => ({
  projectId: 'p1',
  projectName: 'Personas',
  contestId: 'hero',
  title: 'Hero page',
  date: '2026-09-24',
  phase,
  seatCount: 2,
  variantsPerSeat: 3,
  seatSpecs: ['claude:opus@high', 'codex:gpt-6-sol@high'],
  winner: null,
  winnerSeatSpec: null,
  shortlist: [],
  parentId: null,
  round: null,
  updatedAtMs: 1,
});
const seats = (a: ContestSeatState, b: ContestSeatState) => [
  { seatId: 'claude-opus_high', spec: 'claude:opus@high', state: a },
  { seatId: 'codex-gpt-6-sol_high', spec: 'codex:gpt-6-sol@high', state: b },
];

describe('live feed transitions', () => {
  it('ignores the first observation of a contest', () => {
    const mem = createLiveFeedMemory();
    expect(observePhase(mem, 'k', 'review')).toBe(false);
    expect(observePhase(mem, 'k', 'review')).toBe(false);
  });

  it('notices a transition INTO review, once', () => {
    const mem = createLiveFeedMemory();
    observePhase(mem, 'k', 'running');
    expect(observePhase(mem, 'k', 'collecting')).toBe(false);
    expect(observePhase(mem, 'k', 'review')).toBe(true);
    expect(observePhase(mem, 'k', 'review')).toBe(false);
    expect(observePhase(mem, 'k', 'shortlisted')).toBe(false);
  });

  it('noticesFor: seeds silently, then one ready and one seat-limit notice', () => {
    const mem = createLiveFeedMemory();
    expect(noticesFor(mem, summary('running'), seats('running', 'seat-limit'))).toEqual([]);
    expect(noticesFor(mem, summary('running'), seats('seat-limit', 'seat-limit')).map((n) => n.kind)).toEqual([
      'seat-limit',
    ]);
    expect(noticesFor(mem, summary('review'), seats('seat-limit', 'seat-limit')).map((n) => n.kind)).toEqual(['ready']);
    expect(noticesFor(mem, summary('review'), seats('seat-limit', 'seat-limit'))).toEqual([]);
  });

  it('a phase seeded from the list lets the first event notify', () => {
    const mem = createLiveFeedMemory();
    mem.phases.set('p1/hero', 'collecting');
    expect(noticesFor(mem, summary('review'), seats('completed', 'completed')).map((n) => n.kind)).toEqual(['ready']);
  });
});
