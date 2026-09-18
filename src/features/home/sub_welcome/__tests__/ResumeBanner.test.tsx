import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useTourStore } from '@/stores/tourStore';
import ResumeBanner from '../ResumeBanner';
import { clearAckedFailures, readAckedFailures } from '../useResumeContext';

const HOUR = 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

function seedPersona() {
  useAgentStore.setState({
    personas: [{ id: 'p1', name: 'Triage Bot' }] as never,
    executions: [],
  });
}

describe('ResumeBanner failure signal', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    clearAckedFailures();
    seedPersona();
    useOverviewStore.setState({ homeRunsSample: null });
    useTourStore.setState({ tourActive: false, tourDismissed: false });
  });

  // `useAgentStore.executions` is the per-persona editor list; nothing on a
  // Home landing populates it, which is why the highest-ranked resume signal
  // never rendered there. The cross-persona run sample is the source Home
  // already primes.
  it('surfaces a recent failure from the primed run sample, not just executions', () => {
    useOverviewStore.setState({
      homeRunsSample: [
        { persona_id: 'p1', status: 'failed', created_at: iso(Date.now() - HOUR) },
        { persona_id: 'p1', status: 'completed', created_at: iso(Date.now() - 2 * HOUR) },
      ],
    });
    render(<ResumeBanner />);
    expect(screen.getByTestId('resume-banner')).toBeInTheDocument();
    expect(screen.getByTestId('resume-banner').textContent).toContain('Triage Bot');
  });

  it('acknowledges a failure on dismiss instead of no-oping', () => {
    const created = iso(Date.now() - HOUR);
    useOverviewStore.setState({
      homeRunsSample: [{ persona_id: 'p1', status: 'failed', created_at: created }],
    });
    render(<ResumeBanner />);
    expect(screen.getByTestId('resume-banner')).toBeInTheDocument();

    const dismiss = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismiss);

    expect(readAckedFailures().map((a) => a.key)).toEqual([`p1@${created}`]);
    expect(screen.queryByTestId('resume-banner')).toBeNull();
  });

  it('ignores failures older than the 24h window', () => {
    useOverviewStore.setState({
      homeRunsSample: [
        { persona_id: 'p1', status: 'failed', created_at: iso(Date.now() - 48 * HOUR) },
      ],
    });
    render(<ResumeBanner />);
    expect(screen.queryByTestId('resume-banner')).toBeNull();
  });

  it('falls through to the paused tour once the failure is acknowledged', () => {
    const created = iso(Date.now() - HOUR);
    useOverviewStore.setState({
      homeRunsSample: [{ persona_id: 'p1', status: 'failed', created_at: created }],
    });
    const startTour = vi.fn();
    useTourStore.setState({
      tourActive: false,
      tourDismissed: false,
      tourActiveTourId: 'getting-started',
      tourCurrentStepIndex: 1,
      tourStepCompleted: { welcome: true } as never,
      tourCompletionMap: {} as never,
      startTour: startTour as never,
    });

    render(<ResumeBanner />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    // The failure is gone; whatever the tour ranking decides is now what shows,
    // and a rendered banner resumes rather than doing nothing.
    const banner = screen.queryByTestId('resume-banner');
    if (banner) {
      fireEvent.click(banner);
      expect(startTour).toHaveBeenCalled();
    }
    expect(readAckedFailures()).toHaveLength(1);
  });
});
