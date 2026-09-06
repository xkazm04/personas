import { describe, it, expect } from 'vitest';
import type { ClaudeUsageWindow } from '@/lib/bindings/ClaudeUsageWindow';
import {
  formatCountdown, meterTone, orderWindows, pace, windowProgress,
} from '../usageModel';

const H = 3_600_000;
const NOW = 1_700_000_000_000;
const UNITS = { day: 'd', hour: 'h', minute: 'm', underMinute: '<1m' };

function win(over: Partial<ClaudeUsageWindow>): ClaudeUsageWindow {
  return { key: 'five_hour', utilizationPct: 0, resetsAtMs: NOW + 5 * H, windowMs: 5 * H, ...over };
}

describe('meterTone', () => {
  it('steps at 75 and 90', () => {
    expect(meterTone(0)).toBe('ok');
    expect(meterTone(74.9)).toBe('ok');
    expect(meterTone(75)).toBe('warning');
    expect(meterTone(90)).toBe('error');
    expect(meterTone(100)).toBe('error');
  });
});

describe('windowProgress', () => {
  it('derives elapsed fraction from the reset and the window length', () => {
    // 2h into a 5h window → 3h remaining, 40% elapsed.
    const p = windowProgress(win({ resetsAtMs: NOW + 3 * H }), NOW);
    expect(p.remainingMs).toBe(3 * H);
    expect(p.elapsedFrac).toBeCloseTo(0.4, 5);
  });
  it('floors a past reset at zero remaining, fully elapsed', () => {
    const p = windowProgress(win({ resetsAtMs: NOW - H }), NOW);
    expect(p.remainingMs).toBe(0);
    expect(p.elapsedFrac).toBe(1);
  });
  it('is null without a reset', () => {
    expect(windowProgress(win({ resetsAtMs: null }), NOW)).toEqual({ remainingMs: null, elapsedFrac: null });
  });
});

describe('pace', () => {
  it('compares utilisation with the elapsed clock, ±10 points', () => {
    const halfway = { resetsAtMs: NOW + 2.5 * H }; // 50% elapsed
    expect(pace(win({ ...halfway, utilizationPct: 61 }), NOW)).toBe('fast');
    expect(pace(win({ ...halfway, utilizationPct: 55 }), NOW)).toBe('steady');
    expect(pace(win({ ...halfway, utilizationPct: 39 }), NOW)).toBe('slow');
  });
  it('withholds judgement on a window that has barely started, or has no reset', () => {
    expect(pace(win({ resetsAtMs: NOW + 5 * H - 60_000, utilizationPct: 30 }), NOW)).toBeNull();
    expect(pace(win({ resetsAtMs: null, utilizationPct: 30 }), NOW)).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('prints at most the two largest units', () => {
    expect(formatCountdown(2 * H + 14 * 60_000, UNITS)).toBe('2h 14m');
    expect(formatCountdown(3 * 24 * H + 4 * H + 59 * 60_000, UNITS)).toBe('3d 4h');
    expect(formatCountdown(12 * 60_000, UNITS)).toBe('12m');
    expect(formatCountdown(2 * H, UNITS)).toBe('2h');
    expect(formatCountdown(3 * 24 * H, UNITS)).toBe('3d');
  });
  it('says under a minute rather than 0m', () => {
    expect(formatCountdown(0, UNITS)).toBe('<1m');
    expect(formatCountdown(59_999, UNITS)).toBe('<1m');
  });
});

describe('orderWindows', () => {
  it('sorts 5h first, then the weekly family, unknown keys last', () => {
    const keys = orderWindows([
      win({ key: 'seven_day_opus' }), win({ key: 'mystery' }), win({ key: 'seven_day' }), win({ key: 'five_hour' }),
    ]).map((w) => w.key);
    expect(keys).toEqual(['five_hour', 'seven_day', 'seven_day_opus', 'mystery']);
  });
});
