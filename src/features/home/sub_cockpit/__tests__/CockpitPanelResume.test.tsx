import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTourStore } from '@/stores/tourStore';
import { clearAckedFailures } from '@/features/home/sub_welcome/useResumeContext';
import CockpitPanel from '../CockpitPanel';

const HOUR = 60 * 60 * 1000;

/**
 * The Cockpit is the production Home landing (`DEFAULT_HOME_TAB`). The ranked
 * resume signal used to render only on the dev-only Welcome tab, so a shipped
 * user with a failed run had no continue pointer anywhere on Home.
 */
describe('CockpitPanel resume pointer', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    clearAckedFailures();
    useSystemStore.setState({ contextualCockpit: null });
    useTourStore.setState({ tourActive: false, tourDismissed: false });
    useAgentStore.setState({
      personas: [{ id: 'p1', name: 'Triage Bot' }] as never,
      executions: [],
    });
    useOverviewStore.setState({ homeRunsSample: null });
  });

  it('renders the resume banner on the production landing when a signal exists', async () => {
    useOverviewStore.setState({
      homeRunsSample: [
        { persona_id: 'p1', status: 'failed', created_at: new Date(Date.now() - HOUR).toISOString() },
      ],
    });
    render(<CockpitPanel />);
    await waitFor(() => {
      expect(screen.getByTestId('resume-banner')).toBeInTheDocument();
    });
  });

  it('renders nothing extra when there is no resume signal', async () => {
    render(<CockpitPanel />);
    await waitFor(() => {
      expect(screen.getByTestId('cockpit-panel')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('resume-banner')).toBeNull();
  });
});
