import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { resetInvokeMocks } from '@/test/tauriMock';
import { generateIntervalFireTimes, useCalendarEvents } from '../useCronPreview';
import { parseScheduleEntry } from '../scheduleHelpers';
import type { CronAgent } from '@/lib/bindings/CronAgent';

// Bypass the IPC-token-wait dance in tests (see useCronPreview.test rationale).
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

function makeAgent(over: Partial<CronAgent> = {}): CronAgent {
  return {
    persona_id: 'p1',
    persona_name: 'Agent One',
    persona_icon: null,
    persona_color: null,
    persona_enabled: true,
    headless: false,
    trigger_id: 'trig-abc',
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

describe('generateIntervalFireTimes (engine-anchored)', () => {
  const start = new Date('2026-05-01T00:00:00Z');
  const end = new Date('2026-05-01T01:00:00Z');

  it('anchors the phase on next_trigger_at, not last_triggered_at', () => {
    // Engine anchors interval re-schedules on next_trigger_at. A fire at
    // 00:10 with a 15-min interval must land at :10, :25, :40, :55 — the
    // anchor's phase — regardless of any (stale, late) last_triggered_at.
    const runs = generateIntervalFireTimes(15 * 60, '2026-05-01T00:10:00Z', start, end);
    expect(runs.map((d) => d.toISOString())).toEqual([
      '2026-05-01T00:10:00.000Z',
      '2026-05-01T00:25:00.000Z',
      '2026-05-01T00:40:00.000Z',
      '2026-05-01T00:55:00.000Z',
    ]);
  });

  it('does NOT fabricate past fires when the anchor is in the future', () => {
    // next_trigger_at is future relative to a past window → nothing to project.
    // Past interval activity must come from real run records, never a walk.
    const pastWindowStart = new Date('2026-04-01T00:00:00Z');
    const pastWindowEnd = new Date('2026-04-01T06:00:00Z');
    const runs = generateIntervalFireTimes(
      3600,
      '2026-05-01T00:00:00Z', // anchor after the window
      pastWindowStart,
      pastWindowEnd,
    );
    expect(runs).toEqual([]);
  });

  it('returns nothing for a null anchor (no engine-owned phase to project)', () => {
    expect(generateIntervalFireTimes(3600, null, start, end)).toEqual([]);
  });

  it('returns nothing for a non-positive interval or unparseable anchor', () => {
    expect(generateIntervalFireTimes(0, '2026-05-01T00:00:00Z', start, end)).toEqual([]);
    expect(generateIntervalFireTimes(3600, 'not-a-date', start, end)).toEqual([]);
  });
});

describe('useCalendarEvents — preview seed matches the engine seed', () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it('passes the trigger id as the H-spread seed to cron_fire_times_in_range', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'cron_fire_times_in_range') return ['2026-05-01T09:00:00Z'];
      return undefined;
    });

    const entry = parseScheduleEntry(
      makeAgent({ trigger_id: 'trig-xyz', cron_expression: 'H 9 * * *', timezone: 'UTC' }),
    );
    // Stable references — the hook re-runs its effect whenever `entries`/window
    // identity changes, so a fresh array each render would loop forever.
    const entries = [entry];
    const start = new Date('2026-05-01T00:00:00Z');
    const end = new Date('2026-05-02T00:00:00Z');

    const { result } = renderHook(() => useCalendarEvents(entries, start, end));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const call = vi
      .mocked(invoke)
      .mock.calls.find(([cmd]) => cmd === 'cron_fire_times_in_range');
    expect(call).toBeDefined();
    // The engine fires H-token crons at seed_hash(trigger.id); the preview must
    // hash the SAME id so the rendered minute equals the fired minute.
    expect((call![1] as { seed?: string }).seed).toBe('trig-xyz');
    expect(result.current.events).toHaveLength(1);
  });
});

describe('useCalendarEvents — honest past history (real runs, not health)', () => {
  beforeEach(() => {
    resetInvokeMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('labels a past cron slot from its real run and leaves a skipped slot unknown', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'cron_fire_times_in_range') {
        // One past slot (09:00, has a run) + one skipped past slot (10:00) +
        // one future slot (15:00).
        return [
          '2026-05-01T09:00:00Z',
          '2026-05-01T10:00:00Z',
          '2026-05-01T15:00:00Z',
        ];
      }
      if (cmd === 'list_recent_schedule_runs') {
        return [
          {
            execution_id: 'exec-1',
            trigger_id: 'trig-cron',
            status: 'completed',
            created_at: '2026-05-01T09:00:04Z', // 4s tick lateness
          },
        ];
      }
      return undefined;
    });

    // health:'failing' would previously have painted BOTH past slots red.
    const entry = parseScheduleEntry(
      makeAgent({
        trigger_id: 'trig-cron',
        cron_expression: '0 * * * *',
        timezone: 'UTC',
        recent_executions: 5n,
        recent_failures: 5n, // failing health — must NOT leak into slot outcomes
      }),
    );
    const entries = [entry];
    const start = new Date('2026-05-01T00:00:00Z');
    const end = new Date('2026-05-02T00:00:00Z');

    const { result } = renderHook(() => useCalendarEvents(entries, start, end));
    await vi.waitFor(() => expect(result.current.loading).toBe(false));

    const byTime = new Map(result.current.events.map((e) => [e.time.toISOString(), e.kind]));
    expect(byTime.get('2026-05-01T09:00:00.000Z')).toBe('past-success'); // real run
    expect(byTime.get('2026-05-01T10:00:00.000Z')).toBe('past-unknown'); // skipped, not fabricated
    expect(byTime.get('2026-05-01T15:00:00.000Z')).toBe('projected');    // future
  });

  it('renders interval past activity from real runs (no fabricated nominal slots)', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'list_recent_schedule_runs') {
        return [
          { execution_id: 'exec-a', trigger_id: 'trig-int', status: 'failed', created_at: '2026-05-01T08:30:00Z' },
          { execution_id: 'exec-b', trigger_id: 'trig-int', status: 'completed', created_at: '2026-05-01T11:00:00Z' },
        ];
      }
      return undefined;
    });

    const entry = parseScheduleEntry(
      makeAgent({
        trigger_id: 'trig-int',
        interval_seconds: 3600n,
        next_trigger_at: '2026-05-01T13:00:00Z', // future → projects forward only
        recent_executions: 3n,
      }),
    );
    const entries = [entry];
    const start = new Date('2026-05-01T00:00:00Z');
    const end = new Date('2026-05-02T00:00:00Z');

    const { result } = renderHook(() => useCalendarEvents(entries, start, end));
    await vi.waitFor(() => expect(result.current.loading).toBe(false));

    const kinds = result.current.events.map((e) => e.kind);
    // Two past runs (failure + success) + at least one future projected fire.
    expect(kinds).toContain('past-failure');
    expect(kinds).toContain('past-success');
    expect(kinds).toContain('projected');
    // No fabricated 'past-unknown' walk for the interval trigger.
    expect(kinds).not.toContain('past-unknown');
  });
});
