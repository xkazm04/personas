// A failed alert-rules read must not tell the operator "no rules configured".
import { render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useOverviewStore } from '@/stores/overviewStore';
import { AlertRulesPanel } from '../AlertRulesPanel';

describe('AlertRulesPanel', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['overview', 'alerts']);
  });
  beforeEach(() => {
    useOverviewStore.setState({ alertRules: [], alertRulesLoading: false, alertRulesError: null });
  });

  it('a failed read says it failed', () => {
    useOverviewStore.setState({ alertRulesError: 'boom' });
    render(<AlertRulesPanel />);
    expect(screen.getByText('Failed to load')).toBeTruthy();
    expect(screen.queryByText(/No alert rules configured/)).toBeNull();
  });

  it('a clean empty read still says there are no rules', () => {
    render(<AlertRulesPanel />);
    expect(screen.queryByText('Failed to load')).toBeNull();
    expect(screen.getByText(/No alert rules configured/)).toBeTruthy();
  });
});
