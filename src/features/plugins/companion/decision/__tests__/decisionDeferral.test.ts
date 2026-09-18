/**
 * Skip / Later on the orb's decision queue. sweep #261.
 *
 * The bubble surfaces `queue[0]` and only while nothing else is pending, so a
 * decision the operator will not answer right now blocks everything behind it
 * - hiding or collapsing keeps the same id pending. These cases pin the ledger
 * that lets the queue advance, and the promise that neither verb is permanent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  DECISION_SNOOZE_MS,
  deferDecision,
  deferredCount,
  isDecisionDeferred,
  resetDecisionDeferrals,
  skipDecision,
  undeferDecision,
} from '../decisionDeferral';

describe('decisionDeferral', () => {
  beforeEach(() => resetDecisionDeferrals());
  afterEach(() => {
    vi.useRealTimers();
    resetDecisionDeferrals();
  });

  it('holds a skipped decision back for the rest of the session', () => {
    skipDecision('approval:a1');
    expect(isDecisionDeferred('approval:a1')).toBe(true);
    // Far beyond any snooze window - a skip has no clock.
    expect(isDecisionDeferred('approval:a1', Date.now() + 86_400_000)).toBe(true);
  });

  it('returns a snoozed decision to the queue on the clock', () => {
    const start = Date.parse('2026-09-18T09:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(start);

    deferDecision('review:r1');
    expect(isDecisionDeferred('review:r1', start + 1_000)).toBe(true);
    expect(isDecisionDeferred('review:r1', start + DECISION_SNOOZE_MS + 1)).toBe(false);
  });

  it('never touches a decision it was not given', () => {
    skipDecision('approval:a1');
    expect(isDecisionDeferred('incident:i1')).toBe(false);
  });

  it('drops expired entries as they are read, so the ledger cannot grow forever', () => {
    const start = Date.parse('2026-09-18T09:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(start);

    deferDecision('review:r1');
    deferDecision('review:r2');
    expect(deferredCount(start)).toBe(2);
    expect(deferredCount(start + DECISION_SNOOZE_MS + 1)).toBe(0);
  });

  it('can put a decision back in play immediately', () => {
    skipDecision('approval:a1');
    undeferDecision('approval:a1');
    expect(isDecisionDeferred('approval:a1')).toBe(false);
  });

  it('starts empty, so a restart re-offers everything that was skipped', () => {
    skipDecision('approval:a1');
    // `resetDecisionDeferrals` stands in for the module re-evaluating on a
    // fresh app start: the ledger is memory-only ON PURPOSE - a skipped
    // approval is still pending work.
    resetDecisionDeferrals();
    expect(isDecisionDeferred('approval:a1')).toBe(false);
  });
});
