/**
 * DW-178: the report slice records a failed read in `reportsError`, so the list
 * can tell a failed read from having no reports, and clears it on success.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listReports: vi.fn(),
  getReportCount: vi.fn(),
  getUnreadReportCount: vi.fn(),
  getBulkDeliverySummaries: vi.fn(),
  deleteReport: vi.fn(),
  markAllReportsRead: vi.fn(),
  markReportRead: vi.fn(),
}));

vi.mock('@/api/overview/reports', () => api);

import { create } from 'zustand';
import { createReportSlice } from '../reportSlice';
import type { OverviewStore } from '../../../storeTypes';

function makeStore() {
  return create<OverviewStore>()((...a) => ({
    error: null,
    errorKind: null,
    ...createReportSlice(...a),
  }) as OverviewStore);
}

const reportsError = (store: ReturnType<typeof makeStore>) =>
  (store.getState() as unknown as { reportsError: string | null }).reportsError;

beforeEach(() => {
  api.listReports.mockReset();
  api.getReportCount.mockReset().mockResolvedValue(0);
  api.getUnreadReportCount.mockReset().mockResolvedValue(0);
  api.getBulkDeliverySummaries.mockReset().mockResolvedValue([]);
});

describe('reportSlice.reportsError', () => {
  it('starts null', () => {
    expect(reportsError(makeStore())).toBeNull();
  });

  it('holds a reason after a failed read, and a later success clears it', async () => {
    const store = makeStore();

    api.listReports.mockRejectedValueOnce(new Error('database is locked'));
    await store.getState().fetchReports(true);
    expect(typeof reportsError(store)).toBe('string');
    expect(reportsError(store)).not.toBe('');

    api.listReports.mockResolvedValueOnce([]);
    await store.getState().fetchReports(true);
    expect(reportsError(store)).toBeNull();
  });
});
