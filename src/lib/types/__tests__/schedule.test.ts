import { describe, it, expect } from 'vitest';
import type { CronAgent } from '@/lib/bindings/CronAgent';
import { toSchedule, frequencyToSchedule } from '../schedule';

describe('toSchedule(CronAgent)', () => {
  const baseAgent: CronAgent = {
    persona_id: 'p',
    persona_name: 'A',
    persona_icon: null,
    persona_color: null,
    persona_enabled: true,
    headless: false,
    trigger_id: 't',
    cron_expression: '0 9 * * *',
    interval_seconds: null,
    timezone: 'America/New_York',
    trigger_enabled: true,
    last_triggered_at: null,
    next_trigger_at: null,
    description: '',
    recent_executions: 0,
    recent_failures: 0,
  };

  it('translates cron_expression → cron', () => {
    expect(toSchedule(baseAgent).cron).toBe('0 9 * * *');
  });

  it('passes through timezone and interval_seconds', () => {
    const s = toSchedule({ ...baseAgent, interval_seconds: 300 });
    expect(s.timezone).toBe('America/New_York');
    expect(s.interval_seconds).toBe(300);
  });

  it('null fields normalize to undefined', () => {
    const s = toSchedule({ ...baseAgent, cron_expression: null, timezone: null });
    expect(s.cron).toBeUndefined();
    expect(s.timezone).toBeUndefined();
  });
});

describe('frequencyToSchedule', () => {
  it('daily at 09:00 → cron "0 9 * * *"', () => {
    const s = frequencyToSchedule({ rhythm: 'daily', time: '09:00' });
    expect(s.cron).toBe('0 9 * * *');
  });

  it('daily at 14:30 → cron "30 14 * * *"', () => {
    const s = frequencyToSchedule({ rhythm: 'daily', time: '14:30' });
    expect(s.cron).toBe('30 14 * * *');
  });

  it('weekly Mon/Wed/Fri at 08:00 → cron "0 8 * * 1,3,5"', () => {
    const s = frequencyToSchedule({
      rhythm: 'weekly',
      time: '08:00',
      days: ['mon', 'wed', 'fri'],
    });
    expect(s.cron).toBe('0 8 * * 1,3,5');
  });

  it('weekly with no days → defaults to Monday', () => {
    const s = frequencyToSchedule({ rhythm: 'weekly', time: '09:00', days: [] });
    expect(s.cron).toBe('0 9 * * 1');
  });

  it('monthly on day 15 at 12:00 → cron "0 12 15 * *"', () => {
    const s = frequencyToSchedule({ rhythm: 'monthly', time: '12:00', monthDay: 15 });
    expect(s.cron).toBe('0 12 15 * *');
  });

  it('monthly clamps day to 1..28 (avoiding February surprise)', () => {
    const s31 = frequencyToSchedule({ rhythm: 'monthly', time: '09:00', monthDay: 31 });
    expect(s31.cron).toBe('0 9 28 * *');
    const s0 = frequencyToSchedule({ rhythm: 'monthly', time: '09:00', monthDay: 0 });
    expect(s0.cron).toBe('0 9 1 * *');
  });

  it('once → empty Schedule (caller handles one-shot)', () => {
    const s = frequencyToSchedule({ rhythm: 'once', time: '09:00' });
    expect(s).toEqual({});
  });

  it('preserves timezone when supplied', () => {
    const s = frequencyToSchedule({
      rhythm: 'daily',
      time: '09:00',
      timezone: 'Asia/Tokyo',
    });
    expect(s.timezone).toBe('Asia/Tokyo');
  });

  it('clamps malformed time HH:MM out-of-range → 0..59', () => {
    const s = frequencyToSchedule({ rhythm: 'daily', time: '99:99' });
    expect(s.cron).toBe('59 23 * * *');
  });
});
