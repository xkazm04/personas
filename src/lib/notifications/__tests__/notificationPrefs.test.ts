/**
 * The `notification_prefs` blob had five preferences and no reader at the
 * doors where their events arrive: the healing toast hard-coded critical+high
 * and the spend alert only ran inside the Limits tab. These cases pin the one
 * typed accessor both doors now read, and that an untouched install keeps
 * exactly the toast set it had before.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFS,
  parseNotificationPrefs,
  shouldToastHealing,
} from '../notificationPrefs';

describe('parseNotificationPrefs', () => {
  it('case 1: declared defaults fill every absent field', () => {
    expect(parseNotificationPrefs('{"healing_critical":false}')).toEqual({
      healing_critical: false,
      healing_high: true,
      healing_medium: false,
      healing_low: false,
      spend_alerts: true,
    });
  });

  it('case 2: non-boolean values fall back to the default, never coerced', () => {
    const p = parseNotificationPrefs('{"spend_alerts":"no","healing_low":1}');
    expect(p.spend_alerts).toBe(true);
    expect(p.healing_low).toBe(false);
  });

  it('case 2: non-object blobs read as exactly the defaults, with no extra keys', () => {
    for (const raw of ['["x"]', 'garbage', null]) {
      const p = parseNotificationPrefs(raw);
      expect(p).toEqual(DEFAULT_NOTIFICATION_PREFS);
      expect(Object.keys(p).sort()).toEqual(Object.keys(DEFAULT_NOTIFICATION_PREFS).sort());
    }
  });
});

describe('shouldToastHealing', () => {
  it('case 3: a medium event toasts once the operator turns medium on', () => {
    expect(
      shouldToastHealing(parseNotificationPrefs('{"healing_medium":true}'), {
        severity: 'medium',
        auto_fixed: false,
      }),
    ).toBe(true);
  });

  it('case 4: turning critical off silences critical events', () => {
    expect(
      shouldToastHealing(parseNotificationPrefs('{"healing_critical":false}'), {
        severity: 'critical',
        auto_fixed: false,
      }),
    ).toBe(false);
  });

  it('case 5 [guard]: defaults reproduce the old hard-coded HealingToast filter', () => {
    // The filter HealingToast.tsx:61-64 applied before prefs had a reader.
    const legacy = (e: { severity: string; auto_fixed: boolean }) =>
      !e.auto_fixed && (e.severity === 'critical' || e.severity === 'high');
    for (const severity of ['critical', 'high', 'medium', 'low', 'unknown']) {
      for (const auto_fixed of [false, true]) {
        const e = { severity, auto_fixed };
        expect(shouldToastHealing(DEFAULT_NOTIFICATION_PREFS, e)).toBe(legacy(e));
      }
    }
  });
});
