import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { resetInvokeMocks } from '@/test/tauriMock';
import { useCalendarEvents } from '../useCronPreview';
import { parseScheduleEntry } from '../scheduleHelpers';
import { getWeekRange } from '../calendarHelpers';
import type { CronAgent } from '@/lib/bindings/CronAgent';

// Bypass the IPC-token-wait dance in tests (see useCronPreview.test rationale).
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const HOUR = 3_600_000;

function makeAgent(over: Partial<CronAgent> = {}): CronAgent {
  return {
    persona_id: 'p1',
    persona_name: 'Agent One',
    persona_icon: null,
    persona_color: null,
    persona_enabled: true,
    headless: false,
    trigger_id: 'trig-cap',
    cron_expression: null,
    interval_seconds: null,
    timezone: null,
    trigger_enabled: true,
    last_triggered_at: null,
    next_trigger_at: null,
    description: '',
    recent_executions: 1n,
    recent_failures: 0n,
    ...over,
  };
}

/** Fixed-step crons the mock backend understands, in ms between fires. */
const CRON_STEP_MS: Record<string, number> = {
  '0 * * * *': HOUR,
  '*/15 * * * *': 15 * 60_000,
};

interface FireArgs {
  cronExpression: string;
  start: string;
  end: string;
  max?: number;
}

/**
 * Behaves like `cron_fire_times_in_range` in src-tauri triggers.rs: walks
 * forward from `start`, keeps fires with start <= t < end, stops at
 * min(max ?? 200, 1000). The earliest fires are the ones kept.
 */
function backendFireTimes(args: FireArgs): string[] {
  const step = CRON_STEP_MS[args.cronExpression];
  if (!step) throw new Error(`mock does not know cron ${args.cronExpression}`);
  const cap = Math.min(args.max ?? 200, 1000);
  const startMs = Date.parse(args.start);
  const endMs = Date.parse(args.end);
  // Align to the step on the wall clock grid (local offsets are whole hours in May).
  const local = new Date(startMs);
  local.setMinutes(0, 0, 0);
  let t = local.getTime();
  while (t < startMs) t += step;
  const out: string[] = [];
  while (t < endMs && out.length < cap) {
    out.push(new Date(t).toISOString());
    t += step;
  }
  return out;
}

// A week with no DST change in common zones: Sun 2026-05-03 .. Sun 2026-05-10.
const NOW = new Date(2026, 4, 7, 12, 0, 0, 0); // Thursday 12:00 local

describe('useCalendarEvents — a frequent schedule is drawn across the whole week (DW-126)', () => {
  let fireCalls: FireArgs[];

  beforeEach(async () => {
    resetInvokeMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    fireCalls = [];
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'cron_fire_times_in_range') {
        const a = args as FireArgs;
        fireCalls.push(a);
        return backendFireTimes(a);
      }
      if (cmd === 'list_recent_schedule_runs') return [];
      return undefined;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const week = getWeekRange(NOW);
  const weekStart = week.start;
  const weekEnd = week.end;
  const lastSaturdayHour = weekEnd.getTime() - HOUR;

  function renderWeek(agent: CronAgent) {
    const entries = [parseScheduleEntry(agent)];
    return renderHook(() => useCalendarEvents(entries, weekStart, weekEnd));
  }

  it('an hourly cron viewed on a Thursday shows all 168 fires, projected through Saturday', async () => {
    const { result } = renderWeek(makeAgent({ cron_expression: '0 * * * *' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => {
      const mine = result.current.events.filter((e) => e.triggerId === 'trig-cap');
      expect(mine).toHaveLength((weekEnd.getTime() - weekStart.getTime()) / HOUR);
    });

    const mine = result.current.events.filter((e) => e.triggerId === 'trig-cap');
    expect(mine).toHaveLength(168);
    const projected = mine.filter((e) => e.kind === 'projected');
    expect(projected.some((e) => e.time.getTime() > NOW.getTime())).toBe(true);
    // Friday and Saturday are not blank.
    expect(mine.some((e) => e.time.getDay() === 5)).toBe(true);
    expect(mine.some((e) => e.time.getDay() === 6)).toBe(true);
    const latest = Math.max(...mine.map((e) => e.time.getTime()));
    expect(latest).toBeGreaterThanOrEqual(lastSaturdayHour);
    expect(latest).toBeLessThan(weekEnd.getTime());
  });

  it('an every-15-minute cron shows all 672 fires of the week', async () => {
    const { result } = renderWeek(makeAgent({ cron_expression: '*/15 * * * *' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => {
      const mine = result.current.events.filter((e) => e.triggerId === 'trig-cap');
      expect(mine).toHaveLength(672);
    });
    const mine = result.current.events.filter((e) => e.triggerId === 'trig-cap');
    const latest = Math.max(...mine.map((e) => e.time.getTime()));
    expect(latest).toBeGreaterThanOrEqual(weekEnd.getTime() - 15 * 60_000);
  });

  it('every cron_fire_times_in_range call asks for a bounded number of fires (max <= 1000)', async () => {
    const { result } = renderWeek(makeAgent({ cron_expression: '*/15 * * * *' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fireCalls.length).toBeGreaterThan(0);
    for (const call of fireCalls) {
      expect(typeof call.max).toBe('number');
      expect(call.max!).toBeGreaterThan(0);
      expect(call.max!).toBeLessThanOrEqual(1000);
    }
  });

  // Hourly from now + 30 min reaches the window end in ~60 steps, under the
  // old 80 cap, so it guards the hourly path; the 15-minute interval needs
  // ~238 steps and is the one the cap cut short.
  it.each([
    { label: 'hourly', seconds: 3600 },
    { label: 'every 15 minutes', seconds: 900 },
  ])('an $label interval schedule is projected until the window end', async ({ seconds }) => {
    const anchor = NOW.getTime() + 30 * 60_000;
    const stepMs = seconds * 1000;
    const expected = Math.ceil((weekEnd.getTime() - anchor) / stepMs);

    const { result } = renderWeek(
      makeAgent({
        interval_seconds: BigInt(seconds),
        next_trigger_at: new Date(anchor).toISOString(),
        trigger_enabled: true,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => {
      const projected = result.current.events.filter(
        (e) => e.triggerId === 'trig-cap' && e.kind === 'projected',
      );
      expect(projected).toHaveLength(expected);
    });
    const projected = result.current.events.filter(
      (e) => e.triggerId === 'trig-cap' && e.kind === 'projected',
    );
    const latest = Math.max(...projected.map((e) => e.time.getTime()));
    expect(latest).toBeGreaterThan(weekEnd.getTime() - stepMs - 1);
    expect(latest).toBeLessThan(weekEnd.getTime());
  });
});
