import { describe, expect, it } from 'vitest';
import type { PersonaTrigger } from '@/lib/types/types';
import { getTriggerArmState, isWithinActiveWindow } from '../triggerArmState';

const mk = (enabled: boolean, activeWindow?: Record<string, unknown>): PersonaTrigger =>
  ({
    enabled,
    config: activeWindow ? JSON.stringify({ active_window: activeWindow }) : '{}',
  } as unknown as PersonaTrigger);

// A fixed instant so day/hour assertions are deterministic regardless of CI tz.
const NOW = new Date('2026-06-15T12:00:00Z');
const WD = NOW.getUTCDay(); // weekday of NOW, evaluated in UTC

describe('getTriggerArmState', () => {
  it('is disabled when the trigger is off', () => {
    expect(getTriggerArmState(mk(false), NOW)).toBe('disabled');
  });

  it('is armed when there is no active window', () => {
    expect(getTriggerArmState(mk(true), NOW)).toBe('armed');
  });

  it('is armed when the active window exists but is not enabled', () => {
    expect(getTriggerArmState(mk(true, { enabled: false, days: [WD], start_hour: 0, end_hour: 1, timezone: 'UTC' }), NOW)).toBe('armed');
  });

  it('is armed when enabled with no days (no real constraint)', () => {
    expect(getTriggerArmState(mk(true, { enabled: true, days: [], timezone: 'UTC' }), NOW)).toBe('armed');
  });

  it('is sleeping when inside the active days but outside the hours', () => {
    expect(getTriggerArmState(mk(true, { enabled: true, days: [WD], start_hour: 9, start_minute: 0, end_hour: 11, end_minute: 0, timezone: 'UTC' }), NOW)).toBe('sleeping');
  });

  it('is armed when inside both the active days and hours', () => {
    expect(getTriggerArmState(mk(true, { enabled: true, days: [WD], start_hour: 9, end_hour: 18, timezone: 'UTC' }), NOW)).toBe('armed');
  });

  it('is sleeping when today is excluded from the active days', () => {
    const otherDays = [(WD + 1) % 7, (WD + 2) % 7];
    expect(getTriggerArmState(mk(true, { enabled: true, days: otherDays, start_hour: 0, end_hour: 23, end_minute: 59, timezone: 'UTC' }), NOW)).toBe('sleeping');
  });
});

describe('isWithinActiveWindow (overnight window)', () => {
  const overnight = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start_hour: 22, start_minute: 0, end_hour: 6, end_minute: 0, timezone: 'UTC' };
  it('is active late at night (>= start)', () => {
    expect(isWithinActiveWindow(overnight, new Date('2026-06-15T23:30:00Z'))).toBe(true);
  });
  it('is active early morning (< end)', () => {
    expect(isWithinActiveWindow(overnight, new Date('2026-06-15T05:00:00Z'))).toBe(true);
  });
  it('is inactive midday', () => {
    expect(isWithinActiveWindow(overnight, new Date('2026-06-15T12:00:00Z'))).toBe(false);
  });
});
