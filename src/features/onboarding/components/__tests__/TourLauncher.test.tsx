import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

import { useSystemStore } from '@/stores/systemStore';
import { useTourStore } from '@/stores/tourStore';
import { getActiveTourSteps } from '@/stores/slices/system/tourSlice';
import TourLauncher from '../TourLauncher';

const startTour = vi.fn();

function seed(over: Record<string, unknown>) {
  useTourStore.setState({
    tourActive: false,
    tourCompleted: false,
    tourDismissed: false,
    tourStepCompleted: {} as never,
    tourCompletionMap: {} as never,
    tourActiveTourId: 'getting-started',
    startTour: startTour as never,
    ...over,
  } as never);
}

/** Mark the first `n` steps of a tour as completed. */
function progress(tourId: string, n: number): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const s of getActiveTourSteps(tourId as never).slice(0, n)) out[s.id] = true;
  return out;
}

describe('TourLauncher resume target', () => {
  beforeEach(() => {
    cleanup();
    startTour.mockReset();
    useSystemStore.setState({ onboardingActive: false });
    vi.useFakeTimers();
  });

  // The launcher hardcoded the tier default, so a user paused inside another
  // tour was sent into getting-started - the same defect the registry already
  // recorded against `defaultTourId`.
  it('resumes the unfinished active tour rather than getting-started', () => {
    seed({
      tourActiveTourId: 'teams-orchestration',
      tourStepCompleted: progress('teams-orchestration', 1) as never,
    });
    render(<TourLauncher />);
    fireEvent.click(screen.getByTestId('tour-launcher'));
    act(() => { vi.advanceTimersByTime(100); });
    expect(startTour).toHaveBeenCalledWith('teams-orchestration');
  });

  it('counts progress against the tour it will actually start', () => {
    seed({
      tourActiveTourId: 'teams-orchestration',
      tourStepCompleted: progress('teams-orchestration', 2) as never,
    });
    render(<TourLauncher />);
    const total = getActiveTourSteps('teams-orchestration' as never).length;
    expect(screen.getByTestId('tour-launcher').textContent).toContain(`2/${total}`);
  });

  it('falls back to the tier default when the active tour has no progress', () => {
    seed({ tourActiveTourId: 'teams-orchestration' });
    render(<TourLauncher />);
    fireEvent.click(screen.getByTestId('tour-launcher'));
    act(() => { vi.advanceTimersByTime(100); });
    expect(startTour).toHaveBeenCalledWith('getting-started');
  });

  it('falls back to the tier default when the active tour is already complete', () => {
    seed({
      tourActiveTourId: 'teams-orchestration',
      tourStepCompleted: progress('teams-orchestration', 1) as never,
      tourCompletionMap: { 'teams-orchestration': true } as never,
    });
    render(<TourLauncher />);
    fireEvent.click(screen.getByTestId('tour-launcher'));
    act(() => { vi.advanceTimersByTime(100); });
    expect(startTour).toHaveBeenCalledWith('getting-started');
  });
});
