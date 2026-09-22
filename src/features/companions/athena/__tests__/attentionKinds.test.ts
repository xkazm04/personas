import { describe, expect, it } from 'vitest';
import {
  ATTENTION_KINDS,
  DEFAULT_EXPANDED_KINDS,
  EMPTY_ATTENTION_COUNTS,
  isAttentionKind,
  isCountableNudge,
  nudgeSeverity,
  totalAttention,
} from '../attention/attentionKinds';

describe('nudgeSeverity', () => {
  it('routes failure-shaped triggers to errors', () => {
    for (const k of ['fleet_failed', 'fleet_stuck_dispatched', 'incident_blocker', 'backlog_aging']) {
      expect(nudgeSeverity(k)).toBe('errors');
    }
  });

  it('routes drift-shaped triggers to warnings', () => {
    for (const k of ['fleet_awaiting', 'fleet_stale', 'goal_target_approaching', 'execution_review']) {
      expect(nudgeSeverity(k)).toBe('warnings');
    }
  });

  it('treats everything else as informational rather than inventing urgency', () => {
    for (const k of ['on_this_day', 'cadence_due', 'message_digest', 'brand_new_kind_2027']) {
      expect(nudgeSeverity(k)).toBe('nudges');
    }
  });
});

describe('isCountableNudge', () => {
  it('excludes message_attention, which is already aggregated on the digest card', () => {
    expect(isCountableNudge('message_attention')).toBe(false);
    expect(isCountableNudge('message_digest')).toBe(true);
  });
});

describe('attention taxonomy', () => {
  it('only blocked is expanded out of the box', () => {
    expect(DEFAULT_EXPANDED_KINDS).toEqual(['blocked']);
  });

  it('every kind has a zero entry so counts never read undefined', () => {
    for (const k of ATTENTION_KINDS) {
      expect(EMPTY_ATTENTION_COUNTS[k]).toBe(0);
    }
    expect(totalAttention(EMPTY_ATTENTION_COUNTS)).toBe(0);
  });

  it('totals across kinds and validates ids', () => {
    expect(totalAttention({ ...EMPTY_ATTENTION_COUNTS, errors: 2, nudges: 3 })).toBe(5);
    expect(isAttentionKind('blocked')).toBe(true);
    expect(isAttentionKind('nope')).toBe(false);
  });
});
