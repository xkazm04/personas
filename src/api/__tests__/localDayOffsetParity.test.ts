// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invokeWithTimeout = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invokeWithTimeout(...a),
}));

import { getHealthBundle } from '@/api/overview/health';
import { getSlaDashboard } from '@/api/overview/sla';
import {
  getAllMonthlySpend,
  getExecutionHeatmap,
  getOverviewBundle,
} from '@/api/overview/observability';

/** Every overview command that buckets by the user's local day, and the
 *  argument it carries the offset in. */
const CASES: Array<[string, () => Promise<unknown>, string]> = [
  ['get_health_bundle', () => getHealthBundle(), 'utcOffsetMinutes'],
  ['get_sla_dashboard', () => getSlaDashboard(30), 'utcOffsetMinutes'],
  ['get_all_monthly_spend', () => getAllMonthlySpend(), 'utcOffsetMinutes'],
  ['get_overview_bundle', () => getOverviewBundle(30, 'p-offset-test'), 'utcOffsetMinutes'],
  ['get_execution_heatmap', () => getExecutionHeatmap(30), 'tzOffsetMinutes'],
];

describe('local-day offset: every overview command sends minutes EAST of UTC', () => {
  beforeEach(() => {
    invokeWithTimeout.mockReset();
    invokeWithTimeout.mockResolvedValue({});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const [tzOffset, expected] of [[-120, 120], [300, -300]] as const) {
    it(`getTimezoneOffset() = ${tzOffset} -> ${expected} on all ${CASES.length} commands`, async () => {
      vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(tzOffset);
      for (const [cmd, call, arg] of CASES) {
        invokeWithTimeout.mockClear();
        await call();
        const sent = invokeWithTimeout.mock.calls.find((c) => c[0] === cmd);
        expect(sent, cmd).toBeDefined();
        expect((sent![1] as Record<string, unknown>)[arg], cmd).toBe(expected);
      }
    });
  }
});
