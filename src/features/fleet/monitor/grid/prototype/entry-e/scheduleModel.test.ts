import { describe, expect, it } from 'vitest';
import type { ScheduledTaskView } from '@/lib/bindings/ScheduledTaskView';
import { pragueTime, scheduleLamp, taskLamp } from './scheduleModel';

const task = (over: Partial<ScheduledTaskView> = {}): ScheduledTaskView => ({
  name: 'CuratorNight', title: 'Curator night', window: '23:00-07:00', enabled: true, state: 'Ready',
  nextRunMs: null, lastRunMs: null, lastResult: null, ...over,
});

describe('pragueTime', () => {
  // 2026-10-13 21:00 UTC is 23:00 in Prague (CEST, UTC+2).
  const summer = Date.UTC(2026, 9, 13, 21, 0);
  // 2026-12-01 22:00 UTC is 23:00 in Prague (CET, UTC+1).
  const winter = Date.UTC(2026, 11, 1, 22, 0);

  it('shows Prague wall-clock time across the summer-time change', () => {
    expect(pragueTime(summer, 'en', summer - 3_600_000)).toContain('23:00');
    expect(pragueTime(winter, 'en', winter - 3_600_000)).toContain('23:00');
  });

  it('names the weekday within the week and the date beyond it', () => {
    expect(pragueTime(summer, 'en', summer - 3_600_000)).toMatch(/Tue/);
    expect(pragueTime(winter, 'en', summer)).toMatch(/Dec/);
  });

  it('falls back to English for a language the runtime does not know', () => {
    expect(pragueTime(summer, 'not-a-locale-!', summer)).toContain('23:00');
  });
});

describe('lamps', () => {
  it('lights green while anything is scheduled, amber while running, dark when all are off', () => {
    expect(scheduleLamp([task()])).toEqual({ tone: 'ok', lit: true });
    expect(scheduleLamp([task(), task({ state: 'Running' })])).toEqual({ tone: 'warn', lit: true });
    expect(scheduleLamp([task({ enabled: false, state: 'Disabled' })])).toEqual({ tone: 'off', lit: false });
    expect(taskLamp(task({ enabled: false, state: 'Disabled' })).lit).toBe(false);
  });
});
