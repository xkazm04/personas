/**
 * DW-178: a failed read of Messages is not "no messages".
 *
 * When the first read failed the only trace was a passing toast: the list went
 * on to its empty branch and told a person with hundreds of reports that none
 * matched, or that they had none, with no retry. Activity and Events already
 * show a banner and a retry.
 *
 * The list opens on the unread filter, so "any filter is active" holds on
 * arrival. A failed-read branch gated on no active filter would never fire.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listReports: vi.fn(),
  getReportCount: vi.fn(),
  getUnreadReportCount: vi.fn(),
  getBulkDeliverySummaries: vi.fn(),
}));

vi.mock('@/api/overview/reports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/overview/reports')>()),
  ...api,
}));
vi.mock('@/hooks/realtime/useReportCreatedListener', () => ({
  useReportCreatedListener: () => {},
}));
// jsdom has no layout, so the real virtualizer yields no rows at all.
vi.mock('@/hooks/utility/interaction/useVirtualList', () => ({
  useVirtualList: (items: unknown[], size: number) => ({
    parentRef: { current: null },
    virtualizer: {
      getTotalSize: () => items.length * size,
      getVirtualItems: () => items.map((_, index) => ({ index, start: index * size, size })),
    },
  }),
}));

import { en } from '@/i18n/en';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useOverviewStore } from '@/stores/overviewStore';
import ReportList from '../ReportList';

const V = en.overview.reports_view;

const report = {
  id: 'r1', persona_id: 'p1', execution_id: null, title: 'The weekly report', content: 'body',
  content_type: 'markdown', priority: 'normal', is_read: false, metadata: null,
  created_at: '2026-11-05T09:00:00Z', read_at: null, thread_id: null, use_case_id: null,
};

const retryButton = () => screen.queryByRole('button', { name: en.common.retry });
const showRead = () => screen.getByRole('button', { name: new RegExp(V.show_read_reports) });

beforeAll(async () => {
  await preloadSectionsAsync('en', ['overview']);
});

beforeEach(() => {
  api.listReports.mockReset();
  api.getReportCount.mockReset().mockResolvedValue(0);
  api.getUnreadReportCount.mockReset().mockResolvedValue(0);
  api.getBulkDeliverySummaries.mockReset().mockResolvedValue([]);
  useOverviewStore.setState({ reports: [], reportsTotal: 0, unreadReportCount: 0 });
});

describe('ReportList: a failed read says it failed', () => {
  it('a failed first read shows the banner, not an empty list, under either read filter', async () => {
    api.listReports.mockRejectedValue(new Error('database is locked'));
    render(<ReportList />);

    await waitFor(() => expect(retryButton()).not.toBeNull());
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText(V.no_reports)).toBeNull();
    expect(screen.queryByText(V.no_filter_match)).toBeNull();

    fireEvent.click(showRead());
    expect(retryButton()).not.toBeNull();
    expect(screen.queryByText(V.no_reports)).toBeNull();
  });

  it('retry that succeeds renders the row and the banner goes', async () => {
    api.listReports.mockRejectedValueOnce(new Error('database is locked'));
    render(<ReportList />);
    await waitFor(() => expect(retryButton()).not.toBeNull());

    api.listReports.mockResolvedValue([report]);
    api.getReportCount.mockResolvedValue(1);
    api.getUnreadReportCount.mockResolvedValue(1);
    fireEvent.click(retryButton()!);

    expect(await screen.findByText(report.title)).toBeTruthy();
    expect(retryButton()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a read that resolves empty is still the no-reports state, with no banner', async () => {
    api.listReports.mockResolvedValue([]);
    render(<ReportList />);

    fireEvent.click(showRead());
    expect(await screen.findByText(V.no_reports)).toBeTruthy();
    expect(retryButton()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('rows on screen survive a failing refetch, with no banner', async () => {
    api.listReports.mockResolvedValueOnce([report]);
    api.getReportCount.mockResolvedValue(1);
    render(<ReportList />);
    expect(await screen.findByText(report.title)).toBeTruthy();

    api.listReports.mockRejectedValue(new Error('database is locked'));
    await act(async () => {
      await useOverviewStore.getState().fetchReports(true);
    });

    expect(screen.getByText(report.title)).toBeTruthy();
    expect(retryButton()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
