// fleetGridModel — the pure half of the Activity board.
//
// The badge tests exist because the ORDER of `actionBadges` is not decoration:
// a 38px square renders exactly one chip (`dominantBadge` = the head), so if the
// order regresses, a persona with a failed run advertises "1 unread report" and
// the operator reads the board wrong. That is invisible in a screenshot.

import { describe, it, expect } from 'vitest';
import type { ManualReviewItem } from '@/lib/types/types';
import type { PersonaReport } from '@/lib/bindings/PersonaReport';
import type { PersonaCardModel } from '../../monitorModel';
import {
  actionBadges, dominantBadge, actionWeight, squareState, tallyStates, groupFleet,
} from '../fleetGridModel';

const review = (id: string): ManualReviewItem => ({ id, severity: 'warning' } as unknown as ManualReviewItem);
const report = (id: string): PersonaReport => ({ id } as unknown as PersonaReport);

function card(o: Partial<PersonaCardModel> = {}): PersonaCardModel {
  return {
    personaId: 'p', personaName: 'P', personaIcon: null, personaColor: null,
    reviews: [], reviewCounts: { critical: 0, warning: 0, info: 0 }, topReviewSeverity: null,
    messages: [], processes: [],
    running: 0, queued: 0, inputRequired: 0, draftReady: 0, runningSince: null,
    execState: 'idle', attentionCount: 0,
    healthStatus: null, recentStatuses: [], successRate: null, runsToday: 0, totalRecent: 0,
    liveCostUsd: 0, liveToolCalls: 0,
    ...o,
  };
}

describe('actionBadges', () => {
  it('returns nothing for a quiet card', () => {
    expect(actionBadges(card())).toEqual([]);
    expect(dominantBadge(card())).toBeNull();
  });

  it('ranks a failed run above every queue', () => {
    const c = card({
      execState: 'failed',
      reviews: [review('r1')], topReviewSeverity: 'critical',
      messages: [report('m1')], inputRequired: 2, draftReady: 1,
    });
    expect(actionBadges(c).map((b) => b.key)).toEqual(['failed', 'review', 'input', 'draft', 'message']);
    expect(dominantBadge(c)!.key).toBe('failed');
    // `failed` is a state, not a queue — it must never render a count.
    expect(dominantBadge(c)!.count).toBe(0);
  });

  it('carries the real queue depth on countable kinds', () => {
    const c = card({ reviews: [review('a'), review('b')], topReviewSeverity: 'warning' });
    expect(dominantBadge(c)).toMatchObject({ key: 'review', count: 2 });
  });

  it('tints a review chip by its top severity', () => {
    const crit = dominantBadge(card({ reviews: [review('a')], topReviewSeverity: 'critical' }))!;
    const info = dominantBadge(card({ reviews: [review('a')], topReviewSeverity: 'info' }))!;
    expect(crit.tone).not.toEqual(info.tone);
    expect(crit.tone).toContain('status-error');
    expect(info.tone).toContain('status-info');
  });

  it('ignores reviews with no resolved severity bucket', () => {
    // topReviewSeverity is what picks the icon + tone; without it there is
    // nothing honest to paint, so the badge is dropped rather than guessed.
    expect(actionBadges(card({ reviews: [review('a')] }))).toEqual([]);
  });

  it('pairs every chip tone with an inverting foreground', () => {
    const kinds = actionBadges(card({
      execState: 'failed', reviews: [review('a')], topReviewSeverity: 'warning',
      inputRequired: 1, draftReady: 1, messages: [report('m')],
    }));
    for (const b of kinds) expect(b.tone).toContain('text-background');
  });
});

describe('actionWeight', () => {
  it('sums every pending item, counting a failed run once', () => {
    expect(actionWeight(card({
      execState: 'failed', reviews: [review('a'), review('b')],
      messages: [report('m')], inputRequired: 3, draftReady: 1,
    }))).toBe(8);
    expect(actionWeight(card())).toBe(0);
  });
});

describe('squareState / tallyStates', () => {
  it('keeps the badge and the square colour independent', () => {
    // A running persona with an unread report is still RUNNING (colour) while
    // advertising a message (badge) — the two axes must not collapse.
    const c = card({ execState: 'running', running: 1, messages: [report('m')] });
    expect(squareState(c)).toBe('running');
    expect(dominantBadge(c)!.key).toBe('message');
  });

  it('tallies by state', () => {
    const t = tallyStates([card({ execState: 'failed' }), card({ execState: 'idle' })]);
    expect(t).toMatchObject({ failed: 1, idle: 1, running: 0 });
  });
});

describe('groupFleet', () => {
  it('drops teamless personas into ungrouped', () => {
    const cards = [card({ personaId: 'a' }), card({ personaId: 'b' })];
    const personas = [{ id: 'a', home_team_id: 't1' }, { id: 'b', home_team_id: null }] as never;
    const teams = [{ id: 't1', name: 'Team One', color: '#fff' }] as never;
    const g = groupFleet(cards, personas, teams);
    expect(g.teams).toHaveLength(1);
    expect(g.teams[0]!.cards.map((c) => c.personaId)).toEqual(['a']);
    expect(g.ungrouped.map((c) => c.personaId)).toEqual(['b']);
  });
});
