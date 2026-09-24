import { describe, expect, it } from 'vitest';

import { detailFixture, summaryFixture } from '../../../__tests__/fixtures';
import { seatWinRates } from '../../../stats';
import { isReviewable, ledgerGains, variantSeatSpec, variantsByLetter } from '../model/ledgerFacts';
import { moveCursor, resolveLedgerKey, shouldIgnoreKey } from '../model/ledgerKeys';
import { orderLedger } from '../model/ledgerOrder';
import { stageRail } from '../model/stageRail';

const states = (phase: Parameters<typeof stageRail>[0]['phase'], extra = {}) =>
  stageRail({ phase, ...extra }).cells.map((c) => c.state);

describe('stageRail', () => {
  it('lays a running contest out at Run', () => {
    const r = stageRail({ phase: 'running' });
    expect(r.at).toBe('run');
    expect(r.activity).toBe('working');
    expect(states('running')).toEqual(['done', 'done', 'current', 'todo', 'todo', 'todo', 'todo']);
  });

  it('a draft waits at Run, idle', () => {
    expect(stageRail({ phase: 'draft' }).activity).toBe('idle');
  });

  it('review marks judge as passed when judges are unknown, skipped when off, done when on', () => {
    expect(states('review')[4]).toBe('passed');
    expect(states('review', { judgesEnabled: false })[4]).toBe('skipped');
    expect(states('review', { judgesEnabled: true })[4]).toBe('done');
    expect(stageRail({ phase: 'review' }).activity).toBe('attention');
  });

  it('judges off are skipped even before the contest reaches them', () => {
    expect(states('running', { judgesEnabled: false })[4]).toBe('skipped');
  });

  it('decided closes every stage', () => {
    const r = stageRail({ phase: 'decided', judgesEnabled: true });
    expect(r.closed).toBe(true);
    expect(r.cells.every((c) => c.state === 'done')).toBe(true);
  });

  it('a failure sits at Run, or at Collect when the chain failed', () => {
    expect(stageRail({ phase: 'failed' }).cells[2]!.state).toBe('failed');
    const chain = stageRail({ phase: 'failed', chainStep: 'failed' });
    expect(chain.at).toBe('collect');
    expect(chain.cells[3]!.state).toBe('failed');
  });
});

describe('ledger keys', () => {
  it('maps the ledger layer', () => {
    expect(resolveLedgerKey('ledger', 'j')).toEqual({ kind: 'move', by: 1 });
    expect(resolveLedgerKey('ledger', 'ArrowUp')).toEqual({ kind: 'move', by: -1 });
    expect(resolveLedgerKey('ledger', 'Enter')).toEqual({ kind: 'toggle-row' });
    expect(resolveLedgerKey('ledger', 'r')).toEqual({ kind: 'open-review' });
    expect(resolveLedgerKey('ledger', 'n')).toEqual({ kind: 'new-contest' });
    expect(resolveLedgerKey('ledger', '1')).toBeNull();
  });

  it('maps the review layer: trays, unsort, pin mode', () => {
    expect(resolveLedgerKey('review', '1')).toEqual({ kind: 'bucket', bucket: 'failure' });
    expect(resolveLedgerKey('review', '4')).toEqual({ kind: 'bucket', bucket: 'winner' });
    expect(resolveLedgerKey('review', '0')).toEqual({ kind: 'bucket', bucket: null });
    expect(resolveLedgerKey('review', 'p')).toEqual({ kind: 'pin-mode' });
    expect(resolveLedgerKey('review', 'n')).toBeNull();
  });

  it('leaves text fields, dialogs, chords and Enter-on-a-button alone', () => {
    const base = { ctrlKey: false, metaKey: false, altKey: false };
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const inDialog = document.createElement('span');
    dialog.appendChild(inDialog);
    const button = document.createElement('button');
    expect(shouldIgnoreKey({ ...base, key: 'j', target: input })).toBe(true);
    expect(shouldIgnoreKey({ ...base, key: '1', target: textarea })).toBe(true);
    expect(shouldIgnoreKey({ ...base, key: '1', target: inDialog })).toBe(true);
    expect(shouldIgnoreKey({ ...base, key: 'j', ctrlKey: true, target: document.body })).toBe(true);
    expect(shouldIgnoreKey({ ...base, key: 'Enter', target: button })).toBe(true);
    expect(shouldIgnoreKey({ ...base, key: 'j', target: button })).toBe(false);
    expect(shouldIgnoreKey({ ...base, key: 'j', target: document.body })).toBe(false);
  });

  it('clamps the cursor', () => {
    expect(moveCursor(0, -1, 3)).toBe(0);
    expect(moveCursor(2, 1, 3)).toBe(2);
    expect(moveCursor(1, 1, 3)).toBe(2);
    expect(moveCursor(4, 1, 0)).toBe(0);
  });
});

describe('orderLedger', () => {
  it('puts refine rounds under their parent, newest roots first', () => {
    const rows = orderLedger([
      summaryFixture({ contestId: 'old', updatedAtMs: 1 }),
      summaryFixture({ contestId: 'kid-2', parentId: 'new', round: 3, updatedAtMs: 9 }),
      summaryFixture({ contestId: 'new', updatedAtMs: 5 }),
      summaryFixture({ contestId: 'kid-1', parentId: 'new', round: 2, updatedAtMs: 8 }),
      summaryFixture({ contestId: 'orphan', parentId: 'gone', round: 2, updatedAtMs: 3 }),
    ]);
    expect(rows.map((r) => `${r.summary.contestId}:${r.depth}`)).toEqual([
      'new:0',
      'kid-1:1',
      'kid-2:1',
      'orphan:0',
      'old:0',
    ]);
  });

  it('survives a parent cycle', () => {
    const rows = orderLedger([
      summaryFixture({ contestId: 'a', parentId: 'b' }),
      summaryFixture({ contestId: 'b', parentId: 'a' }),
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe('ledger facts', () => {
  it('names the seat that made a variant', () => {
    const d = detailFixture();
    expect(variantSeatSpec(d, d.variants[1]!)).toBe('codex:gpt-6-sol@high');
    expect(variantSeatSpec(d, { seatId: 'nope' })).toBeNull();
    expect(variantsByLetter(d.variants).map((g) => g.letter)).toEqual(['A', 'B']);
    expect(isReviewable('review')).toBe(true);
    expect(isReviewable('running')).toBe(false);
  });

  it('a gain carries the winner, its seat, its round and the seat interval', () => {
    const summaries = [
      summaryFixture({ contestId: 'x', phase: 'decided', winner: 'A/1', winnerSeatSpec: 'claude:claude-opus-5-5@xhigh', round: 2, updatedAtMs: 5 }),
      summaryFixture({ contestId: 'y', phase: 'decided', winner: 'B/1', winnerSeatSpec: 'codex:gpt-6-sol@high', updatedAtMs: 9 }),
      summaryFixture({ contestId: 'z', phase: 'review' }),
    ];
    const gains = ledgerGains(summaries, seatWinRates(summaries).rows);
    expect(gains.map((g) => g.summary.contestId)).toEqual(['y', 'x']);
    expect(gains[1]!.round).toBe(2);
    expect(gains[0]!.round).toBe(1);
    expect(gains[0]!.rate).toMatchObject({ spec: 'codex:gpt-6-sol@high', wins: 1, entered: 2 });
  });
});
