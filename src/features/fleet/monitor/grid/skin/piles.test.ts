// piles - the fleet's one state vocabulary.
//
// The pile is derived, never stored: these tests pin that it agrees with the
// Monitor's own ranking (`actionWeight`, `actionBadges`, `pillarStateKey`), so
// a persona cannot be "needs you" on one Activity surface and quiet on another.
//
// The `buildBoard` block that used to close this file went with the Board view
// (2026-10-06); `boardModel.ts` no longer exists.

import { describe, expect, it } from 'vitest';
import type { ManualReviewItem } from '@/lib/types/types';
import type { PersonaReport } from '@/lib/bindings/PersonaReport';
import type { PersonaCardModel } from '../../monitorModel';
import { countPiles, needReason, needTone, orderByPile, pileOf } from './piles';

// Test fixtures: only the fields the derivations read are meaningful.
const review = (id: string): ManualReviewItem => ({ id, severity: 'warning', created_at: '2026-10-05T08:00:00Z' } as unknown as ManualReviewItem);
const report = (id: string): PersonaReport => ({ id, created_at: '2026-10-05T07:00:00Z' } as unknown as PersonaReport);

function card(o: Partial<PersonaCardModel> = {}): PersonaCardModel {
  return {
    personaId: 'p', personaName: 'P', personaIcon: null, personaColor: null, enabled: true,
    reviews: [], reviewCounts: { critical: 0, warning: 0, info: 0 }, topReviewSeverity: null,
    reviewCount: 0, messages: [], messageCount: 0, processes: [],
    running: 0, queued: 0, inputRequired: 0, draftReady: 0, runningSince: null,
    execState: 'idle', attentionCount: 0,
    healthStatus: null, recentStatuses: [], successRate: null, runsToday: 0, totalRecent: 0,
    liveCostUsd: 0, liveToolCalls: 0,
    ...o,
  };
}

describe('pileOf', () => {
  it('sorts the four piles from the Monitor state', () => {
    expect(pileOf(card())).toBe('resting');
    expect(pileOf(card({ running: 1, execState: 'running' }))).toBe('working');
    expect(pileOf(card({ enabled: false }))).toBe('off');
    expect(pileOf(card({ execState: 'failed' }))).toBe('needs');
    expect(pileOf(card({ queued: 2, execState: 'attention' }))).toBe('resting');
  });

  it('counts an unread message as needing you (the operator chose this)', () => {
    expect(pileOf(card({ messageCount: 3 }))).toBe('needs');
    expect(pileOf(card({ messages: [report('m')] }))).toBe('needs');
  });

  it('lets needs win over working and off', () => {
    expect(pileOf(card({ running: 1, execState: 'running', reviewCount: 1, topReviewSeverity: 'info' }))).toBe('needs');
    expect(pileOf(card({ enabled: false, inputRequired: 1 }))).toBe('needs');
  });
});

describe('needReason / needTone', () => {
  it('takes the head of the badge order', () => {
    const all = card({ execState: 'failed', reviews: [review('r')], topReviewSeverity: 'critical', inputRequired: 1, messageCount: 2 });
    expect(needReason(all)).toBe('failed');
    expect(needReason(card({ inputRequired: 1, messageCount: 2 }))).toBe('input');
    expect(needReason(card({ draftReady: 1 }))).toBe('draft');
    expect(needReason(card())).toBeNull();
  });

  it('reads an unclassified review count as a review', () => {
    expect(needReason(card({ reviewCount: 2 }))).toBe('review');
  });

  it('is red for a failure or a critical review, amber otherwise', () => {
    expect(needTone(card({ execState: 'failed' }))).toBe('critical');
    expect(needTone(card({ reviews: [review('r')], topReviewSeverity: 'critical' }))).toBe('critical');
    expect(needTone(card({ reviews: [review('r')], topReviewSeverity: 'warning' }))).toBe('warning');
    expect(needTone(card({ messageCount: 1 }))).toBe('warning');
  });
});

describe('orderByPile / countPiles', () => {
  const cards = [
    card({ personaId: 'off', enabled: false }),
    card({ personaId: 'rest' }),
    card({ personaId: 'msg', messageCount: 1 }),
    card({ personaId: 'run', running: 1, execState: 'running' }),
    card({ personaId: 'fail', execState: 'failed' }),
    card({ personaId: 'rest2' }),
    card({ personaId: 'crit', reviewCount: 1, topReviewSeverity: 'critical' }),
  ];

  it('orders needs (most urgent first) > working > resting > off, stable inside a pile', () => {
    expect(orderByPile(cards).map((c) => c.personaId)).toEqual(['fail', 'crit', 'msg', 'run', 'rest', 'rest2', 'off']);
  });

  it('counts the piles and the critical needs', () => {
    expect(countPiles(cards)).toEqual({ needs: 3, critical: 2, working: 1, resting: 2, off: 1, total: 7 });
  });
});
