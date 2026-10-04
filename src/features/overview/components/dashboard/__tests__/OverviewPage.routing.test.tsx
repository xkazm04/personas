/**
 * Overview route ladder: every sidebar-declared Overview tab mounts its own
 * lazy surface, and none silently falls through to the Dashboard default.
 *
 * Written 2026-09-25 when Observability was routed. The dashboard had sat
 * unimported since a March 2026 refactor (src/lib/analytics/navCatalog.ts
 * records the history) and nothing failed, because the router's last branch
 * renders the Dashboard for any tab it does not know. This test closes that:
 * a tab id in `overviewItems` without its own router case now fails here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/overview/useExecutionDashboardPipeline', () => ({ useExecutionDashboardPipeline: () => {} }));

vi.mock('@/features/overview/components/dashboard/DashboardWithSubtabs', () => ({ default: () => <div data-testid="tab-home" /> }));
vi.mock('@/features/overview/sub_incidents', () => ({ default: () => <div data-testid="tab-incidents" /> }));
vi.mock('@/features/overview/sub_observability', () => ({ default: () => <div data-testid="tab-observability" /> }));
vi.mock('@/features/overview/components/dashboard/ExecutionsWithSubtabs', () => ({ default: () => <div data-testid="tab-executions" /> }));
vi.mock('@/features/overview/sub_manual-review/components/ManualReviewList', () => ({ default: () => <div data-testid="tab-manual-review" /> }));
vi.mock('@/features/overview/sub_reports/components/ReportList', () => ({ default: () => <div data-testid="tab-messages" /> }));
vi.mock('@/features/overview/sub_events/components/EventLogList', () => ({ default: () => <div data-testid="tab-events" /> }));
vi.mock('@/features/overview/sub_memories/components/MemoriesPage', () => ({ default: () => <div data-testid="tab-memories" /> }));
vi.mock('@/features/overview/sub_memories/components/MemoriesPageGraph', () => ({ default: () => <div data-testid="tab-memory-graph" /> }));

import OverviewPage from '../OverviewPage';
import { useOverviewStore } from '@/stores/overviewStore';
import { overviewItems, overviewGroups } from '@/features/shared/chrome/sidebar/sidebarData';
import type { OverviewTab } from '@/lib/types/types';

const tabIds = overviewItems.map((i) => i.id);

describe('Overview route ladder', () => {
  beforeEach(() => {
    useOverviewStore.setState({ overviewTab: 'home' });
  });

  it.each(tabIds)('mounts the "%s" surface, not the Dashboard fallback', async (tab: OverviewTab) => {
    useOverviewStore.setState({ overviewTab: tab });
    render(<OverviewPage />);
    expect(await screen.findByTestId(`tab-${tab}`)).toBeTruthy();
    if (tab !== 'home') expect(screen.queryByTestId('tab-home')).toBeNull();
  });

  it('declares Observability in the sidebar, right after Incidents', () => {
    expect(tabIds.indexOf('observability')).toBe(tabIds.indexOf('incidents') + 1);
    const ops = overviewGroups.find((g) => g.id === 'operations');
    expect(ops?.itemIds).toContain('observability');
    expect(ops!.itemIds.indexOf('observability')).toBe(ops!.itemIds.indexOf('incidents') + 1);
  });
});
