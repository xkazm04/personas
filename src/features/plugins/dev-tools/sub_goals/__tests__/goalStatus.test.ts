import { describe, it, expect } from 'vitest';
import {
  normalizeGoalStatus,
  isComplete,
  isBlocked,
  isInProgress,
  isOpen,
  isOngoing,
  GOAL_STATUSES,
  GOAL_STATUS_META,
} from '../goalStatus';

describe('normalizeGoalStatus', () => {
  it('maps the hyphen/underscore in-progress variants to one canonical value (the v1 bug)', () => {
    expect(normalizeGoalStatus('in-progress')).toBe('in-progress');
    expect(normalizeGoalStatus('in_progress')).toBe('in-progress');
    expect(normalizeGoalStatus('running')).toBe('in-progress');
    expect(normalizeGoalStatus('active')).toBe('in-progress');
  });

  it('maps done/completed aliases to done', () => {
    expect(normalizeGoalStatus('done')).toBe('done');
    expect(normalizeGoalStatus('completed')).toBe('done');
    expect(normalizeGoalStatus('complete')).toBe('done');
    expect(normalizeGoalStatus('skipped')).toBe('done');
  });

  it('maps blocked / review variants to blocked', () => {
    expect(normalizeGoalStatus('blocked')).toBe('blocked');
    expect(normalizeGoalStatus('review')).toBe('blocked');
    expect(normalizeGoalStatus('awaiting_review')).toBe('blocked');
  });

  it('falls back to open for pending/queued/unknown/empty (never throws)', () => {
    expect(normalizeGoalStatus('open')).toBe('open');
    expect(normalizeGoalStatus('pending')).toBe('open');
    expect(normalizeGoalStatus('queued')).toBe('open');
    expect(normalizeGoalStatus('totally-unknown')).toBe('open');
    expect(normalizeGoalStatus('')).toBe('open');
    expect(normalizeGoalStatus(null)).toBe('open');
    expect(normalizeGoalStatus(undefined)).toBe('open');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(normalizeGoalStatus('  In_Progress ')).toBe('in-progress');
    expect(normalizeGoalStatus('DONE')).toBe('done');
  });
});

describe('status predicates', () => {
  it('classify both hyphen and underscore forms identically', () => {
    expect(isInProgress('in_progress')).toBe(true);
    expect(isInProgress('in-progress')).toBe(true);
    expect(isComplete('completed')).toBe(true);
    expect(isComplete('done')).toBe(true);
    expect(isBlocked('review')).toBe(true);
    expect(isOpen('pending')).toBe(true);
  });

  it('isOngoing is the inverse of done', () => {
    expect(isOngoing('done')).toBe(false);
    expect(isOngoing('completed')).toBe(false);
    expect(isOngoing('open')).toBe(true);
    expect(isOngoing('in_progress')).toBe(true);
    expect(isOngoing('blocked')).toBe(true);
  });
});

describe('GOAL_STATUS_META', () => {
  it('has a complete, lane-mapped entry for every canonical status', () => {
    for (const s of GOAL_STATUSES) {
      const meta = GOAL_STATUS_META[s];
      expect(meta).toBeDefined();
      expect(['your_turn', 'agent_turn', 'done']).toContain(meta.lane);
      expect(meta.map.fill).toMatch(/^#/);
    }
  });

  it('lanes the canonical statuses as the board expects', () => {
    expect(GOAL_STATUS_META.open.lane).toBe('your_turn');
    expect(GOAL_STATUS_META.blocked.lane).toBe('your_turn');
    expect(GOAL_STATUS_META['in-progress'].lane).toBe('agent_turn');
    expect(GOAL_STATUS_META.done.lane).toBe('done');
  });
});
