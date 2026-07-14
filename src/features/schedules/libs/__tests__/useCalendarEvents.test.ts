import { describe, it, expect, beforeEach, vi } from 'vitest';
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
