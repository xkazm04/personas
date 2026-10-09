import { describe, expect, it } from 'vitest';

import { STATUS_PALETTE } from '@/lib/design/statusTokens';

import { isDeadlineMissed, laneTone, laneToneOf } from '../rowCanvas';

const NOW = new Date('2026-10-09T12:00:00');

describe('deadline lane look', () => {
  it('an ordinary milestone keeps its cut-state tone, whatever its date', () => {
    const lane = { status: 'active', kind: 'milestone', targetDate: '2020-01-01' };
    expect(laneToneOf(lane)).toBe(laneTone('active'));
    expect(isDeadlineMissed(lane, NOW)).toBe(false);
  });

  it('a deadline is missed only once its whole day is over', () => {
    const today = { status: 'planned', kind: 'deadline', targetDate: '2026-10-09' };
    const yesterday = { ...today, targetDate: '2026-10-08' };
    expect(isDeadlineMissed(today, NOW)).toBe(false);
    expect(isDeadlineMissed(yesterday, NOW)).toBe(true);
  });

  it('a shipped deadline is never missed and reads as shipped', () => {
    const lane = { status: 'shipped', kind: 'deadline', targetDate: '2020-01-01' };
    expect(isDeadlineMissed(lane, NOW)).toBe(false);
    expect(laneToneOf(lane)).toBe(STATUS_PALETTE.success);
  });

  it('an open deadline wears the warning hue, a missed one the error hue', () => {
    expect(laneToneOf({ status: 'active', kind: 'deadline', targetDate: '2999-01-01' })).toBe(STATUS_PALETTE.warning);
    expect(laneToneOf({ status: 'active', kind: 'deadline', targetDate: '2000-01-01' })).toBe(STATUS_PALETTE.error);
  });
});
