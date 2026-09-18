import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

import { useTourStore } from '@/stores/tourStore';
import { getActiveTourSteps } from '@/stores/slices/system/tourSlice';
import HomeLearning from '../HomeLearning';

// The composed-tours lane issues IPC on mount and is not what these cases are
// about; a resolved empty list keeps the built-in registry the only subject.
vi.mock('../useComposedTours', () => ({
  useComposedTours: () => ({
    entries: [],
    total: 0,
    loading: false,
    status: 'loaded',
    reload: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const TOUR = 'templates-recipes';

function stepsDone(tourId: string, n: number): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const s of getActiveTourSteps(tourId as never).slice(0, n)) out[s.id] = true;
  return out;
}

/**
 * A tour with saved step progress rendered exactly like one never started:
 * no chip, and a modal offering Start. The only Continue in the app was the
 * footer launcher, which resumed getting-started and nothing else.
 */
describe('HomeLearning tour progress', () => {
  beforeEach(() => {
    cleanup();
    useTourStore.setState({
      tourActive: false,
      tourCompleted: false,
      tourDismissed: false,
      tourStepCompleted: {} as never,
      tourCompletionMap: {} as never,
      tourActiveTourId: 'getting-started',
      startTour: vi.fn() as never,
    } as never);
  });

  it('shows an in-progress chip for a tour with saved steps', async () => {
    useTourStore.setState({ tourStepCompleted: stepsDone(TOUR, 2) as never });
    render(<HomeLearning />);
    const total = getActiveTourSteps(TOUR as never).length;
    const chip = await screen.findByTestId(`learning-tour-progress-${TOUR}`);
    expect(chip.textContent).toContain(`2/${total}`);
  });

  it('shows no chip for a tour that was never started', async () => {
    render(<HomeLearning />);
    await screen.findByTestId(`learning-tour-${TOUR}`);
    expect(screen.queryByTestId(`learning-tour-progress-${TOUR}`)).toBeNull();
  });

  it('offers Continue in the detail modal, and startTour resumes at the saved step', async () => {
    const startTour = vi.fn();
    useTourStore.setState({
      tourStepCompleted: stepsDone(TOUR, 2) as never,
      startTour: startTour as never,
    });
    render(<HomeLearning />);

    fireEvent.click(await screen.findByTestId(`learning-tour-${TOUR}`));
    const cta = await screen.findByTestId(`tour-modal-start-${TOUR}`);
    expect(cta.textContent).toMatch(/continue/i);

    fireEvent.click(cta);
    await waitFor(() => {
      expect(startTour).toHaveBeenCalledWith(TOUR);
    });
  });

  it('still says Restart for a completed tour', async () => {
    useTourStore.setState({
      tourStepCompleted: stepsDone(TOUR, 2) as never,
      tourCompletionMap: { [TOUR]: true } as never,
    });
    render(<HomeLearning />);
    fireEvent.click(await screen.findByTestId(`learning-tour-${TOUR}`));
    const cta = await screen.findByTestId(`tour-modal-start-${TOUR}`);
    expect(cta.textContent).toMatch(/restart/i);
    expect(screen.queryByTestId(`learning-tour-progress-${TOUR}`)).toBeNull();
  });
});
