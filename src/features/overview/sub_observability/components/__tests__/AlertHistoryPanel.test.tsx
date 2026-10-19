// A failed alert-history read must not tell the operator "All clear".
import { render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useOverviewStore } from '@/stores/overviewStore';
import { AlertHistoryPanel } from '../AlertHistoryPanel';

describe('AlertHistoryPanel', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['overview']);
  });
  beforeEach(() => {
    useOverviewStore.setState({ alertHistory: [], alertHistoryLoading: false, alertHistoryError: null });
  });

  it('a failed read says it failed', () => {
    useOverviewStore.setState({ alertHistoryError: 'Database error: locked' });
    render(<AlertHistoryPanel />);
    expect(screen.getByText('Failed to load')).toBeTruthy();
    expect(screen.queryByText(/All clear/)).toBeNull();
  });

  it('a clean empty read still says all clear', () => {
    render(<AlertHistoryPanel />);
    expect(screen.queryByText('Failed to load')).toBeNull();
    expect(screen.getByText(/All clear/)).toBeTruthy();
  });
});
