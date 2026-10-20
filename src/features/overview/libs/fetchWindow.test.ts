import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildFetchWindow, customRangeDays, fetchWindowKey } from './fetchWindow';

const invokeWithTimeout = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invokeWithTimeout(...a),
}));

describe('buildFetchWindow', () => {
  it('is null for a preset so the call stays days-only', () => {
    expect(buildFetchWindow(null, false)).toBeNull();
    expect(fetchWindowKey(null)).toBe('');
  });

  it('covers the named days: Jan 1-10 is [Jan 1 00:00, Jan 11 00:00) local', () => {
    const w = buildFetchWindow(['2026-01-01', '2026-01-10'], false)!;
    expect(new Date(w.start).getTime()).toBe(new Date(2026, 0, 1).getTime());
    expect(new Date(w.end).getTime()).toBe(new Date(2026, 0, 11).getTime());
    expect(customRangeDays(['2026-01-01', '2026-01-10'])).toBe(10);
    expect(customRangeDays(['2026-01-05', '2026-01-05'])).toBe(1);
  });

  it('Compare stretches the start back one period', () => {
    const w = buildFetchWindow(['2026-01-01', '2026-01-10'], true)!;
    expect(new Date(w.start).getTime()).toBe(new Date(2025, 11, 22).getTime());
    expect(new Date(w.end).getTime()).toBe(new Date(2026, 0, 11).getTime());
  });
});

describe('dashboard and bundle carry the window to the backend', () => {
  beforeEach(() => {
    invokeWithTimeout.mockReset();
    invokeWithTimeout.mockResolvedValue({});
  });

  it('sends start/end for a custom range and omits them for a preset', async () => {
    const { getExecutionDashboard, getOverviewBundle } = await import('@/api/overview/observability');
    const w = buildFetchWindow(['2026-01-01', '2026-01-10'], false)!;
    await getExecutionDashboard(10, w);
    await getOverviewBundle(10, 'p-win', w);
    const dash = invokeWithTimeout.mock.calls.find((c) => c[0] === 'get_execution_dashboard')![1];
    const bundle = invokeWithTimeout.mock.calls.find((c) => c[0] === 'get_overview_bundle')![1];
    expect(dash).toMatchObject({ days: 10, start: w.start, end: w.end });
    expect(bundle).toMatchObject({ days: 10, start: w.start, end: w.end });

    invokeWithTimeout.mockClear();
    await getExecutionDashboard(30);
    expect(invokeWithTimeout.mock.calls[0]![1]).toMatchObject({ days: 30, start: undefined, end: undefined });
  });
});
