import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import CockpitPanel from '../CockpitPanel';

/**
 * The Build / Ask band was the UAT fix for an onboarding overlay nothing
 * launched. It mounted only on the dev-only Welcome tab, so the shipped
 * first-run landing (Cockpit) offered a chat CTA and no explicit first action.
 */
describe('CockpitPanel first-run CTA', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useSystemStore.setState({
      contextualCockpit: null,
      onboardingCompleted: false,
      onboardingDismissedAtStep: null,
    });
    useOverviewStore.setState({ homeRunsSample: null });
    // The panel fetches personas when the fleet is empty; a resolved no-op
    // keeps `isLoading` false so the band's own guard is what is under test.
    useAgentStore.setState({
      personas: [],
      executions: [],
      isLoading: false,
      fetchPersonas: (async () => {}) as never,
    });
  });

  it('shows Build / Ask on a fresh production profile', async () => {
    render(<CockpitPanel />);
    await waitFor(() => {
      expect(screen.getByTestId('welcome-get-started')).toBeInTheDocument();
    });
  });

  // Dismissing the overlay records the step and deliberately does NOT set
  // `onboardingCompleted`, so the band must survive a dismiss.
  it('still shows after the overlay was dismissed rather than completed', async () => {
    useSystemStore.setState({
      onboardingCompleted: false,
      onboardingDismissedAtStep: 'appearance' as never,
    });
    render(<CockpitPanel />);
    await waitFor(() => {
      expect(screen.getByTestId('welcome-get-started')).toBeInTheDocument();
    });
  });

  it('is gone once the profile has a persona', async () => {
    useAgentStore.setState({ personas: [{ id: 'p1', name: 'Triage Bot' }] as never });
    render(<CockpitPanel />);
    await waitFor(() => {
      expect(screen.getByTestId('cockpit-panel')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('welcome-get-started')).toBeNull();
  });
});
