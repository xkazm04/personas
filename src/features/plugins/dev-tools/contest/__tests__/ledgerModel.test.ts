import { describe, expect, it } from 'vitest';

import type { ContestSeat } from '@/lib/bindings/ContestSeat';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

import {
  attentionOf,
  benchLayout,
  heatPercent,
  ledgerCounts,
  ledgerGroups,
  ledgerOrder,
  microGroups,
  microSize,
  panelEstimate,
  recentPanels,
  reportedCost,
  seasonSpend,
  seatEstimate,
  seatSuggestions,
  strandFraction,
  verdictOf,
} from '../ledger/ledgerModel';
import { ledgerFixture, summaryFixture } from './fixtures';

const NOW = 1_758_700_000_000;

function seat(over: Partial<ContestSeat> = {}): ContestSeat {
  return {
    seatId: 'claude-claude-opus-5-5_xhigh',
    spec: 'claude:claude-opus-5-5@xhigh',
    kind: 'participant',
    state: 'completed',
    fleetSessionId: null,
    letter: 'A',
    wallS: 1800,
    costUsd: 12,
    turns: 90,
    errors: [],
    startedAtMs: NOW - 1800_000,
    ...over,
  };
}

function contest(id: string, over: Partial<ContestSummary> = {}): ContestSummary {
  return summaryFixture({ contestId: id, title: `Contest ${id}`, ...over });
}

const EFFORT_WORDS = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' } as const;
const text = (s: ContestSummary) => s.title;

describe('attention', () => {
  it('review waits for the owner, live phases and drafts are moving, the rest is settled', () => {
    expect(attentionOf('review')).toBe('yours');
    for (const p of ['queued', 'running', 'collecting', 'judging', 'draft'] as const) expect(attentionOf(p)).toBe('live');
    for (const p of ['shortlisted', 'decided', 'failed'] as const) expect(attentionOf(p)).toBe('settled');
  });

  it('a refine round waiting for review pulls its shortlisted parent into Needs your verdict', () => {
    const parent = contest('p', { phase: 'shortlisted', updatedAtMs: 1 });
    const round = contest('p-r2', { phase: 'review', parentId: 'p', round: 2, updatedAtMs: 2 });
    const other = contest('o', { phase: 'decided', date: '2026-09-20' });
    const groups = ledgerGroups([round, parent, other], null, '', text);
    expect(groups.map((g) => g.attention)).toEqual(['yours', 'settled']);
    expect(groups[0]!.families[0]!.items.map((i) => i.summary.contestId)).toEqual(['p', 'p-r2']);
    expect(groups[0]!.own).toBe(1);
    expect(groups[0]!.related).toBe(1);
    expect(ledgerOrder(groups)).toEqual(['p1/p', 'p1/p-r2', 'p1/o']);
  });

  it('filters and search keep a whole family when any member matches', () => {
    const parent = contest('p', { phase: 'failed', title: 'Onboarding' });
    const round = contest('p-r2', { phase: 'queued', parentId: 'p', round: 2, title: 'Onboarding round 2' });
    const running = contest('r', { phase: 'running', title: 'Studio' });
    const scheduled = ledgerGroups([parent, round, running], 'scheduled', '', text);
    expect(ledgerOrder(scheduled)).toEqual(['p1/p', 'p1/p-r2']);
    expect(ledgerOrder(ledgerGroups([parent, round, running], null, 'studio', text))).toEqual(['p1/r']);
    expect(ledgerGroups([parent, round, running], null, 'nothing like this', text)).toEqual([]);
  });

  it('counts each phase once, and names the oldest date', () => {
    const c = ledgerCounts([
      contest('a', { phase: 'review', date: '2026-09-22' }),
      contest('b', { phase: 'running', date: '2026-09-21' }),
      contest('c', { phase: 'judging' }),
      contest('d', { phase: 'queued' }),
      contest('e', { phase: 'decided' }),
    ]);
    expect(c).toMatchObject({ total: 5, review: 1, running: 2, scheduled: 1, decided: 1, since: '2026-09-21' });
  });
});

describe('strands', () => {
  it('a running seat stops short of the end; a timed-out one reaches it; an unknown one starts at 0', () => {
    expect(strandFraction(seat({ state: 'running', startedAtMs: NOW - 3600_000 }), 3600, NOW)).toBe(0.985);
    expect(strandFraction(seat({ state: 'running', startedAtMs: NOW - 900_000 }), 3600, NOW)).toBeCloseTo(0.25);
    expect(strandFraction(seat({ state: 'timed-out' }), 3600, NOW)).toBe(1);
    expect(strandFraction(seat({ state: 'completed', wallS: null }), 3600, NOW)).toBe(0);
    expect(strandFraction(seat({ state: 'completed', wallS: 1800 }), null, NOW)).toBe(0);
  });

  it('only seats that ran report a cost; unknown money is never zero', () => {
    expect(reportedCost([seat({ costUsd: 10 }), seat({ costUsd: null }), seat({ state: 'queued', costUsd: 99 })])).toBe(10);
    expect(reportedCost([seat({ costUsd: null })])).toBeNull();
    const unpriced = contest('u', { ledger: ledgerFixture({ seats: [seat({ costUsd: null })] }) });
    expect(seasonSpend([unpriced])).toBeNull();
    expect(seasonSpend([unpriced, contest('p', { ledger: ledgerFixture({ seats: [seat({ costUsd: 4 })] }) })])).toBe(4);
  });
});

describe('micro-stills', () => {
  it('one cell per delivered variant, then an empty cell per variant still owed, struck through when the seat stopped', () => {
    const s = contest('m', {
      variantsPerSeat: 3,
      winner: 'A/2',
      ledger: ledgerFixture({
        seats: [seat(), seat({ seatId: 'codex-gpt-6-sol_high', spec: 'codex:gpt-6-sol@high', state: 'errored' })],
        variants: [
          { key: 'A/1', seatId: 'claude-claude-opus-5-5_xhigh', n: 1, present: true, title: '', concept: 'One', still: null, bucket: 'shortlist' },
          { key: 'A/2', seatId: 'claude-claude-opus-5-5_xhigh', n: 2, present: true, title: '', concept: 'Two', still: null, bucket: null },
        ],
      }),
    });
    const groups = microGroups(s);
    expect(groups[0]!.cells.map((c) => (c.kind === 'still' ? `${c.variant.key}:${c.bucket}` : `empty${c.out ? '-out' : ''}`))).toEqual([
      'A/1:shortlist',
      'A/2:winner',
      'empty',
    ]);
    expect(groups[1]!.cells.map((c) => (c.kind === 'empty' && c.out ? 'out' : 'x'))).toEqual(['out', 'out', 'out']);
    const size = microSize(groups, 234, 40);
    expect(size.w).toBeLessThanOrEqual(40);
    expect(size.h).toBe(Math.round(size.w / 1.6));
  });
});

describe('verdict', () => {
  const variants = [
    { key: 'A/1', seatId: 's', n: 1, present: true, title: '', concept: 'Rail', still: null, bucket: 'winner' as const },
    { key: 'A/2', seatId: 's', n: 2, present: true, title: '', concept: 'Deck', still: null, bucket: null },
  ];

  it('review: sorted count, the tray colours, and the judges lead before an own winner', () => {
    const v = verdictOf(contest('r', { phase: 'review', ledger: ledgerFixture({ variants, judgesLead: { key: 'A/2', mean: 8.4 } }) }), [], NOW);
    expect(v).toMatchObject({ kind: 'review', sorted: 1, total: 2, buckets: ['winner', null], lead: { key: 'A/2', mean: 8.4 }, ownWinner: 'A/1' });
  });

  it('a review with nothing on disk says so instead of 0 of 0', () => {
    expect(verdictOf(contest('e', { phase: 'review' }), [], NOW)).toEqual({ kind: 'review-empty' });
  });

  it('decided names the winner and its concept; failed names the station that stopped', () => {
    expect(verdictOf(contest('d', { phase: 'decided', winner: 'A/1', winnerSeatSpec: 'claude:x@high', ledger: ledgerFixture({ variants }) }), [], NOW)).toEqual({
      kind: 'decided',
      key: 'A/1',
      name: 'Rail',
      spec: 'claude:x@high',
    });
    const failed = contest('f', { phase: 'failed', ledger: ledgerFixture({ chain: { step: 'failed', reason: 'collect: 0 of 2 seats delivered a variant', updatedAtMs: null }, seats: [seat(), seat()] }) });
    expect(verdictOf(failed, [], NOW)).toMatchObject({ kind: 'failed', station: 'collect', delivered: 0, seats: 2 });
  });

  it('queued with a start ahead is a countdown; queued without one is a live count', () => {
    expect(verdictOf(contest('q', { phase: 'queued', ledger: ledgerFixture({ notBeforeMs: NOW + 3600_000 }) }), [], NOW)).toEqual({ kind: 'queued', startMs: NOW + 3600_000 });
    expect(verdictOf(contest('q2', { phase: 'queued', ledger: ledgerFixture({ seats: [seat({ state: 'queued' })] }) }), [], NOW)).toMatchObject({ kind: 'live', phase: 'queued', waiting: 1 });
  });
});

describe('estimates', () => {
  const past = [
    contest('a', { variantsPerSeat: 3, ledger: ledgerFixture({ seats: [seat({ costUsd: 30, wallS: 1800 })] }) }),
    contest('b', { variantsPerSeat: 3, ledger: ledgerFixture({ seats: [seat({ costUsd: 12, wallS: 1200 })] }) }),
    contest('c', { variantsPerSeat: 2, ledger: ledgerFixture({ seats: [seat({ spec: 'claude:claude-opus-5-5@max', costUsd: 20, wallS: 2400, state: 'errored' })] }) }),
    contest('d', { ledger: ledgerFixture({ seats: [seat({ spec: 'codex:gpt-6-sol@high', costUsd: null, wallS: 900 })] }) }),
  ];

  it('prices a seat by the median of its own past runs per variant', () => {
    const e = seatEstimate('claude:claude-opus-5-5@xhigh', past, 3, 60);
    expect(e.basis).toBe('exact');
    expect(e.runs).toBe(2);
    expect(e.cost).toBeCloseTo(21); // (10 + 4) / 2 per variant x 3
    expect(e.wallS).toBe(1500);
  });

  it('a seat never run at this effort borrows the same model at other efforts, and says so', () => {
    const e = seatEstimate('claude:claude-opus-5-5@low', past, 3, 60);
    expect(e.basis).toBe('model');
    expect(e.runs).toBe(3);
    expect(e.failures).toBe(1);
  });

  it('Codex reports no cost: its seat stays unpriced rather than free', () => {
    const e = seatEstimate('codex:gpt-6-sol@high', past, 3, 60);
    expect(e.cost).toBeNull();
    expect(e.reportsCost).toBe(false);
    const panel = panelEstimate(
      [
        { engine: 'claude', model: 'claude-opus-5-5', effort: 'xhigh', label: null },
        { engine: 'codex', model: 'gpt-6-sol', effort: 'high', label: null },
      ],
      past,
      3,
      60,
    );
    expect(panel.unpriced).toBe(1);
    expect(panel.cost).toBeCloseTo(21);
  });

  it('recent panels are the owner\'s real line-ups, newest first, each once', () => {
    const panels = recentPanels([
      contest('x', { seatSpecs: ['claude:a@high', 'codex:b@high#2'] }),
      contest('y', { seatSpecs: ['codex:b@high', 'claude:a@high'] }),
      contest('z', { seatSpecs: ['grok:g@low'] }),
    ]);
    expect(panels.map((p) => p.seats)).toEqual([['claude:a@high', 'codex:b@high'], ['grok:g@low']]);
  });
});

describe('typing a seat', () => {
  it('"opus x" is Opus 5.5 at Extra high, first', () => {
    const [first] = seatSuggestions('opus x', EFFORT_WORDS);
    expect(first).toMatchObject({ engine: 'claude', model: 'claude-opus-5-5', effort: 'xhigh', custom: false });
  });

  it('a model alone offers High first', () => {
    expect(seatSuggestions('sol', EFFORT_WORDS)[0]).toMatchObject({ model: 'gpt-6-sol', effort: 'high' });
  });

  it('an unknown model id is offered on every engine as a custom seat', () => {
    const list = seatSuggestions('llama-4 max', EFFORT_WORDS);
    expect(list.filter((s) => s.custom).map((s) => `${s.engine}:${s.model}@${s.effort}`)).toEqual([
      'claude:llama-4@max',
      'codex:llama-4@max',
      'grok:llama-4@max',
    ]);
  });
});

describe('bench and scores', () => {
  it('prefers one row of wide cards, wrapping only when cards would get narrow', () => {
    expect(benchLayout([4, 0, 1, 1, 0], 800, false).rows).toBe(2);
    expect(benchLayout([2, 0, 0, 0, 0], 800, false)).toMatchObject({ rows: 1, cardW: 200 });
  });

  it('heat runs from 4 % at a 4 to 28 % at a 10, and nothing for a missing score', () => {
    expect(heatPercent(4)).toBe(4);
    expect(heatPercent(10)).toBe(28);
    expect(heatPercent(null)).toBe(0);
  });
});
