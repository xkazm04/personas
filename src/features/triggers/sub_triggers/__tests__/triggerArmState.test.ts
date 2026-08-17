import { describe, expect, it } from 'vitest';
import type { PersonaTrigger } from '@/lib/types/types';
import { getTriggerArmState, isWithinActiveWindow } from '../triggerArmState';

const mk = (
  enabled: boolean,
  activeWindow?: Record<string, unknown>,
  overrides: Partial<PersonaTrigger> = {},
): PersonaTrigger =>
  ({
    enabled,
    // `status` is the column BOTH dispatch predicates read, so it is what the
    // badge reads too. Fixtures keep it consistent with `enabled` unless a test
    // is deliberately exercising drift.
    status: enabled ? 'active' : 'disabled',
    trigger_type: 'manual',
    next_trigger_at: null,
    config: activeWindow ? JSON.stringify({ active_window: activeWindow }) : '{}',
    ...overrides,
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

  // -- reading the column the dispatcher reads -----------------------------

  it('is disabled when status says so even though enabled says otherwise', () => {
    // The drifted shape: `enabled = 1, status != 'active'`. `get_due` and
    // `get_enabled_by_type` both test `status`, so this row will NOT be
    // dispatched — the badge must agree with the engine, not with the flag.
    expect(
      getTriggerArmState(mk(true, undefined, { status: 'paused' } as Partial<PersonaTrigger>), NOW),
    ).toBe('disabled');
    expect(
      getTriggerArmState(mk(true, undefined, { status: 'errored' } as Partial<PersonaTrigger>), NOW),
    ).toBe('disabled');
  });

  it('is disabled when enabled says so even though status says otherwise', () => {
    // The other half of the drift, and the one that shipped: `enabled = 0,
    // status = 'active'` renders OFF while the event bus still dispatches it.
    // The badge stays pessimistic — a row is off if EITHER column says off —
    // so a pending optimistic toggle never reads as armed.
    expect(
      getTriggerArmState(mk(false, undefined, { status: 'active' } as Partial<PersonaTrigger>), NOW),
    ).toBe('disabled');
  });

  // -- the state the badge could not previously express --------------------

  it.each(['schedule', 'polling'])(
    'is unschedulable when a %s trigger has no next_trigger_at',
    (triggerType) => {
      expect(
        getTriggerArmState(
          mk(true, undefined, { trigger_type: triggerType, next_trigger_at: null } as Partial<PersonaTrigger>),
          NOW,
        ),
      ).toBe('unschedulable');
    },
  );

  it('is armed once a time-based trigger has a next fire time', () => {
    expect(
      getTriggerArmState(
        mk(true, undefined, {
          trigger_type: 'schedule',
          next_trigger_at: '2099-01-01T00:00:00Z',
        } as Partial<PersonaTrigger>),
        NOW,
      ),
    ).toBe('armed');
  });

  it.each(['manual', 'webhook', 'chain', 'event_listener', 'file_watcher', 'clipboard', 'app_focus', 'composite'])(
    'does not call %s unschedulable — a null next_trigger_at is correct for it',
    (triggerType) => {
      expect(
        getTriggerArmState(
          mk(true, undefined, { trigger_type: triggerType, next_trigger_at: null } as Partial<PersonaTrigger>),
          NOW,
        ),
      ).toBe('armed');
    },
  );
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
