import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { mockInvoke, resetInvokeMocks } from '@/test/tauriMock';
import { useCronPreview, useCronFireTimesInRange } from '../useCronPreview';

// Bypass the IPC-token-wait dance in tests. Without this, _invokeCore in
// tauriInvoke.ts waits up to 2s per call for `globalThis.__IPC_TOKEN` before
// firing the underlying mock — well beyond the default waitFor timeout.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

describe('useCronPreview', () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it('returns EMPTY for null/empty cron without calling IPC', async () => {
    const { result } = renderHook(() => useCronPreview(null));
    expect(result.current.runs).toEqual([]);
    expect(result.current.valid).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('parses RFC3339 next_runs into Date objects', async () => {
    mockInvoke('preview_cron_schedule', {
      valid: true,
      description: 'Every hour',
      next_runs: ['2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z'],
      error: null,
    });
    const { result } = renderHook(() => useCronPreview('0 * * * *', undefined, 5, 0));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.valid).toBe(true);
    expect(result.current.runs).toHaveLength(2);
    expect(result.current.runs[0]).toBeInstanceOf(Date);
    expect(result.current.runs[0]!.toISOString()).toBe('2026-05-01T10:00:00.000Z');
    expect(result.current.description).toBe('Every hour');
  });

  it('surfaces backend error string when valid=false', async () => {
    mockInvoke('preview_cron_schedule', {
      valid: false,
      description: '',
      next_runs: [],
      error: 'Invalid cron expression: bad input',
    });
    const { result } = renderHook(() => useCronPreview('not a cron', undefined, 5, 0));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.valid).toBe(false);
    expect(result.current.error).toBe('Invalid cron expression: bad input');
    expect(result.current.runs).toEqual([]);
  });

  it('refetches when timezone changes', async () => {
    let calls = 0;
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd !== 'preview_cron_schedule') return undefined;
      calls++;
      const tz = (args as { timezone?: string }).timezone;
      return {
        valid: true,
        description: tz ?? 'no-tz',
        next_runs: [`2026-05-01T${calls.toString().padStart(2, '0')}:00:00Z`],
        error: null,
      };
    });

    const { result, rerender } = renderHook(
      ({ tz }: { tz?: string }) => useCronPreview('0 * * * *', tz, 5, 0),
      { initialProps: { tz: undefined as string | undefined } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.description).toBe('no-tz');

    rerender({ tz: 'America/New_York' });
    await waitFor(() => expect(result.current.description).toBe('America/New_York'));
    expect(calls).toBe(2);
  });
});

describe('useCronFireTimesInRange', () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it('returns empty for empty cron without calling IPC', async () => {
    const start = new Date('2026-05-01T00:00:00Z');
    const end = new Date('2026-05-02T00:00:00Z');
    const { result } = renderHook(() => useCronFireTimesInRange(null, undefined, start, end));
    expect(result.current.runs).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('returns empty when end <= start (degenerate window)', async () => {
    const start = new Date('2026-05-02T00:00:00Z');
    const end = new Date('2026-05-01T00:00:00Z');
    const { result } = renderHook(() => useCronFireTimesInRange('0 * * * *', undefined, start, end));
    expect(result.current.runs).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('parses RFC3339 ISOs into Dates ordered ascending', async () => {
    mockInvoke('cron_fire_times_in_range', [
      '2026-05-01T10:00:00Z',
      '2026-05-01T11:00:00Z',
      '2026-05-01T12:00:00Z',
    ]);
    const start = new Date('2026-05-01T00:00:00Z');
    const end = new Date('2026-05-02T00:00:00Z');
    const { result } = renderHook(() =>
      useCronFireTimesInRange('0 * * * *', 'UTC', start, end),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toHaveLength(3);
    expect(result.current.runs[0]).toBeInstanceOf(Date);
    expect(result.current.runs.map((d) => d.getTime())).toEqual(
      [...result.current.runs.map((d) => d.getTime())].sort((a, b) => a - b),
    );
  });

  it('handles IPC errors without crashing the consumer', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementationOnce(async () => {
      throw new Error('IPC failed');
    });
    const start = new Date('2026-05-01T00:00:00Z');
    const end = new Date('2026-05-02T00:00:00Z');
    const { result } = renderHook(() =>
      useCronFireTimesInRange('0 * * * *', undefined, start, end),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBe('IPC failed');
  });
});

// Suppress unused-import warning when act() is not used in this file.
void act;
