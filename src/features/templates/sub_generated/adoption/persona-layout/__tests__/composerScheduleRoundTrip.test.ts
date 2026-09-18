import { describe, it, expect } from 'vitest';

import {
  composerScheduleToTriggerSelection,
  triggerSelectionToComposerSchedule,
} from '../composerScheduleToTriggerSelection';
import type { TriggerSelection } from '../../useCasePickerShared';

/** Reopen the picker on `sel`, press Apply without changing anything. */
const reopenAndApply = (sel: TriggerSelection): TriggerSelection =>
  composerScheduleToTriggerSelection(triggerSelectionToComposerSchedule(sel), sel);

describe('composer schedule round trip', () => {
  it('keeps an hourly capability hourly through reopen + apply', () => {
    const hourly: TriggerSelection = { time: { preset: 'hourly', hourOfDay: 7, weekday: 1 } };
    // The picker has no Hourly, so it DISPLAYS Daily at the kept hour…
    expect(triggerSelectionToComposerSchedule(hourly).frequency).toBe('daily');
    // …but applying that display must not rewrite the declared trigger.
    expect(reopenAndApply(hourly).time?.preset).toBe('hourly');
  });

  it('keeps weekly and daily untouched through reopen + apply', () => {
    const weekly: TriggerSelection = { time: { preset: 'weekly', hourOfDay: 9, weekday: 3 } };
    expect(reopenAndApply(weekly)).toEqual(weekly);

    const daily: TriggerSelection = { time: { preset: 'daily', hourOfDay: 6 } };
    expect(reopenAndApply(daily)).toEqual(daily);
  });

  it('preserves the Event family and customCron on an unchanged apply', () => {
    const both: TriggerSelection = {
      time: { preset: 'hourly', hourOfDay: 7, weekday: 1 },
      event: { eventType: 'stocks.signal.buy' },
    } as TriggerSelection;
    expect(reopenAndApply(both)).toEqual(both);
  });

  it('still applies a real edit: changing the hour moves it to daily at that hour', () => {
    const hourly: TriggerSelection = { time: { preset: 'hourly', hourOfDay: 7, weekday: 1 } };
    const edited = composerScheduleToTriggerSelection(
      { ...triggerSelectionToComposerSchedule(hourly), time: '10:00' },
      hourly,
    );
    expect(edited.time?.preset).toBe('daily');
    expect(edited.time?.hourOfDay).toBe(10);
  });

  it('still applies a frequency change away from hourly', () => {
    const hourly: TriggerSelection = { time: { preset: 'hourly', hourOfDay: 7, weekday: 1 } };
    const edited = composerScheduleToTriggerSelection(
      { frequency: 'weekly', days: ['wed'], monthDay: 1, time: '07:00' },
      hourly,
    );
    expect(edited.time?.preset).toBe('weekly');
  });

  it('a monthly customCron survives reopen + apply unchanged', () => {
    const monthly: TriggerSelection = { customCron: '0 8 15 * *' };
    expect(reopenAndApply(monthly)).toEqual(monthly);
  });
});
