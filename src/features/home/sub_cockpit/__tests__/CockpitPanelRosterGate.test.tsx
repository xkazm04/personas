import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import CockpitPanel from '../CockpitPanel';

/**
 * Law 6 (`docs/design/overview-loading.md`, 2026-10-03): a region's placeholder is retired by
 * that region's OWN data, and no region waits on another region's fetch.
 *
 * The Cockpit body has two sources that can fill it — Athena's persisted spec and, when she never
 * composed one, the roster the starter cockpit is built from. The spec read settles first and
 * settles with `null` on a profile that never chatted, which left the body with no spec and an
 * empty roster: exactly the state a fleet-less profile is in. The panel read that as "nothing to
 * show" and painted the talk-to-Athena hero (a 440px image), then replaced it with the starter
 * grid when the roster answered. Harness view `home/cockpit/states/loading-roster` photographs
 * that window; this test is its unit twin.
 */
const cockpitSpy = vi.fn();

vi.mock('@/api/companion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/companion')>()),
  companionGetCockpit: () => cockpitSpy(),
}));

vi.mock('@/api/overview/observability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/overview/observability')>()),
  getMetricsSummary: () => new Promise(() => {}),
}));

describe('CockpitPanel — the roster retires its own placeholder', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    cockpitSpy.mockReset();
    // Never composed: the spec read settles with null before the roster read answers.
    cockpitSpy.mockResolvedValue(null);
    useSystemStore.setState({
      contextualCockpit: null,
      onboardingCompleted: true,
      onboardingDismissedAtStep: null,
    });
    useOverviewStore.setState({ homeRunsSample: null });
  });

  it('shows the ghost, not the empty CTA, while the roster fetch is still in flight', async () => {
    let settleRoster: (() => void) | null = null;
    useAgentStore.setState({
      personas: [],
      executions: [],
      isLoading: false,
      fetchPersonas: (() => new Promise<void>((resolve) => { settleRoster = resolve; })) as never,
    });

    render(<CockpitPanel />);

    // The spec read has settled with null by now; the body must still be waiting.
    await waitFor(() => expect(cockpitSpy).toHaveBeenCalled());
    expect(screen.queryByTestId('cockpit-empty-state')).toBeNull();

    // The roster answers with a genuinely empty fleet: NOW the CTA is the honest answer.
    settleRoster?.();
    await waitFor(() => {
      expect(screen.getByTestId('cockpit-empty-state')).toBeInTheDocument();
    });
  });

  it('paints the starter cockpit from a pre-warmed roster without waiting on the metrics', async () => {
    // The shell fetches personas in wave 1, so the usual case never enters the fetch branch at
    // all. `getMetricsSummary` is held above, proving the starter does not wait for it either.
    useAgentStore.setState({
      personas: [{ id: 'p1', name: 'Triage Bot', enabled: true }] as never,
      executions: [],
      isLoading: false,
      fetchPersonas: (async () => {}) as never,
    });

    render(<CockpitPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('cockpit-grid')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('cockpit-empty-state')).toBeNull();
  });
});
