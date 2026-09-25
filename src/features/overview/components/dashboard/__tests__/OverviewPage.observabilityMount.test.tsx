/**
 * Overview > Observability mounts the REAL dashboard through the router.
 *
 * The route-ladder test beside this one stubs every tab to prove the router
 * branches; this one stubs nothing under the dashboard, so a broken import or
 * a render-time throw in the observability tree fails here (IPC resolves
 * `undefined` via src/test/setup.ts, which is the empty-data path).
 * Kept in its own file because vi.mock is hoisted per module.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/overview/useExecutionDashboardPipeline', () => ({ useExecutionDashboardPipeline: () => {} }));

import OverviewPage from '../OverviewPage';
import { useOverviewStore } from '@/stores/overviewStore';

describe('Overview > Observability', () => {
  it('mounts the observability dashboard surface when the tab is selected', async () => {
    useOverviewStore.setState({ overviewTab: 'observability' });
    render(<OverviewPage />);
    expect(await screen.findByTestId('observability-surface', {}, { timeout: 8000 })).toBeTruthy();
  }, 15000);
});
