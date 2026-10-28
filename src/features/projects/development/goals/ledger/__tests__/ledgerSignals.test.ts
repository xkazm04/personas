// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { GOAL_STATUSES } from '../../goalStatus';
import { laneSignal, ledgerFillColor, ledgerFillPct, ledgerRail } from '../ledgerSignals';

describe('ledger turn signals', () => {
  it('maps every status to a glyph and the right rail', () => {
    for (const s of GOAL_STATUSES) expect(laneSignal(s).icon).toBeTruthy();
    expect(laneSignal('open').labelKey).toBe('your_turn');
    expect(laneSignal('awaiting_acceptance').labelKey).toBe('your_turn');
    expect(laneSignal('blocked').labelKey).toBe('your_turn');
    expect(laneSignal('in-progress').labelKey).toBe('agents_turn');
    expect(ledgerRail('open', false)).toContain('amber');
    expect(ledgerRail('in_progress', false)).toContain('blue');
    expect(ledgerRail('done', false)).toBeUndefined();
  });

  it('overdue red wins only while the goal is not done', () => {
    expect(ledgerRail('open', true)).toContain('status-error');
    expect(ledgerRail('in-progress', true)).toContain('status-error');
    expect(ledgerRail('done', true)).toBeUndefined();
  });
});

describe('ledger fill', () => {
  it('uses the checklist when present, else manual progress', () => {
    expect(ledgerFillPct({ done: 1, total: 4 }, 90)).toBe(25);
    expect(ledgerFillPct(undefined, 40)).toBe(40);
    expect(ledgerFillPct({ done: 0, total: 0 }, 40)).toBe(40);
    expect(ledgerFillPct(undefined, null)).toBe(0);
  });
  it('clamps to 0..100', () => {
    expect(ledgerFillPct(undefined, 140)).toBe(100);
    expect(ledgerFillPct(undefined, -5)).toBe(0);
  });
  it('is emerald with a checklist, violet without', () => {
    expect(ledgerFillColor({ done: 1, total: 2 })).toContain('16,185,129');
    expect(ledgerFillColor(undefined)).toContain('139,92,246');
  });
});
