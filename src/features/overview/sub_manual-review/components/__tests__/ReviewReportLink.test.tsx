import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { ReviewReportLink } from '../ReviewReportLink';

describe('ReviewReportLink', () => {
  beforeEach(() => {
    useOverviewStore.setState({ pendingReportFocus: null, overviewTab: 'manual-review' });
    useSystemStore.setState({ sidebarSection: 'overview' });
  });

  it('shows "View report" when the review context names a report', () => {
    render(<ReviewReportLink contextData={JSON.stringify({ reportId: 'rep-42', context_text: 'Council' })} />);
    expect(screen.getByTestId('review-view-report')).toHaveTextContent('View report');
  });

  it.each([
    ['no context', null],
    ['empty context', ''],
    ['free-text context', 'plain note'],
    ['context without a reportId', '{"decisions":[]}'],
    ['a blank reportId', '{"reportId":""}'],
  ])('shows nothing for %s', (_label, ctx) => {
    const { container } = render(<ReviewReportLink contextData={ctx} />);
    expect(screen.queryByTestId('review-view-report')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('opens that report on the Reports tab', () => {
    render(<ReviewReportLink contextData='{"reportId":"rep-42"}' />);

    fireEvent.click(screen.getByTestId('review-view-report'));

    const overview = useOverviewStore.getState();
    expect(overview.pendingReportFocus).toBe('rep-42');
    // `messages` is the Reports tab id (labelled "Reports" in the UI).
    expect(overview.overviewTab).toBe('messages');
    expect(useSystemStore.getState().sidebarSection).toBe('overview');
  });
});
