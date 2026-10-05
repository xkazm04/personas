// piles + boardModel - the Board's one state vocabulary and the fleet it builds.
//
// The pile is derived, never stored: these tests pin that it agrees with the
// Monitor's own ranking (`actionWeight`, `actionBadges`, `pillarStateKey`), so
// a persona cannot be "needs you" on the Board and quiet on Activity.

import { describe, expect, it } from 'vitest';
import type { ManualReviewItem } from '@/lib/types/types';
import type { PersonaReport } from '@/lib/bindings/PersonaReport';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaCardModel } from '../monitorModel';
import { attentionOrder } from '../grid/useAttentionCursor';
import { countPiles, needReason, needTone, orderByPile, pileOf } from './piles';
import { TEAMLESS_BAY, attentionModel, buildBoard } from './boardModel';

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

describe('buildBoard', () => {
  const team = (id: string, workspace_id?: string) => ({ id, name: id.toUpperCase(), color: '#22d3ee', icon: null, workspace_id } as unknown as PersonaTeam);
  const persona = (id: string, home_team_id: string | null) => ({ id, home_team_id } as unknown as Persona);
  const personas = [persona('a', 't1'), persona('b', 't1'), persona('c', 't2'), persona('d', null)];
  const teams = [team('t2'), team('t1'), team('ws', 'w1')];
  const cards = [
    card({ personaId: 'a', personaName: 'A' }),
    card({ personaId: 'b', personaName: 'B', messageCount: 1 }),
    card({ personaId: 'c', personaName: 'C', execState: 'failed', runsToday: 3 }),
    card({ personaId: 'd', personaName: 'D', runsToday: 2 }),
  ];

  it('groups as Activity does, drops empty groups, packs the biggest bay first', () => {
    const board = buildBoard(cards, personas, teams);
    expect(board.bays.map((b) => b.id)).toEqual(['t1', 't2', TEAMLESS_BAY]);
    expect(board.bays[0]!.cards.map((c) => c.personaId)).toEqual(['b', 'a']);
    expect(board.bayOf.get('d')?.kind).toBe('teamless');
    expect(board.runsToday).toBe(5);
  });

  it('ranks the queue by urgency, fleet-wide', () => {
    const board = buildBoard(cards, personas, teams);
    expect(board.queue.map((c) => c.personaId)).toEqual(['c', 'b']);
    expect(board.totals).toMatchObject({ needs: 2, critical: 1, resting: 2 });
  });

  it('hands the attention cursor the needs tiles in the field reading order', () => {
    const board = buildBoard(cards, personas, teams);
    expect(attentionOrder(attentionModel(board.bays, cards))).toEqual(['b', 'c']);
  });
});
