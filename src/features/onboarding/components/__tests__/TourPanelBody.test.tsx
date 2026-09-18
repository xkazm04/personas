import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { useTourStore } from '@/stores/tourStore';
import { getActiveTourSteps } from '@/stores/slices/system/tourSlice';
import { TourPanelBody } from '../TourPanelBody';

const TOUR = 'getting-started';

function renderBody(over: Partial<Parameters<typeof TourPanelBody>[0]> = {}) {
  const props = {
    currentIndex: 0,
    completedSteps: {} as never,
    isStepCompleted: false,
    allCompleted: false,
    subStepIndex: 0,
    tourId: TOUR as never,
    tourColor: 'violet',
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onJump: vi.fn(),
    onComplete: vi.fn(),
    ...over,
  };
  render(<TourPanelBody {...props} />);
  return props;
}

/**
 * The rail's right-hand footer button is where a user reaches for "next". On an
 * incomplete interactive step it was labelled Skip but was still that button
 * and still called the same `onNext`, so a whole tour could be walked without
 * performing a step - and the completion recap counted those steps as done.
 */
describe('TourPanelBody advancement controls', () => {
  beforeEach(() => {
    cleanup();
    useTourStore.setState({ tourStepCompleted: {} as never });
    // The step list reads the live registry; make sure this tour has steps.
    expect(getActiveTourSteps(TOUR as never).length).toBeGreaterThan(0);
  });

  it('disables the primary control while the step is not completed', () => {
    renderBody({ isStepCompleted: false });
    const primary = screen.getByTestId('tour-btn-next');
    expect(primary).toBeDisabled();
  });

  it('does not advance from the primary control on an incomplete step', () => {
    const props = renderBody({ isStepCompleted: false });
    fireEvent.click(screen.getByTestId('tour-btn-next'));
    expect(props.onNext).not.toHaveBeenCalled();
  });

  it('still offers Skip as a separate, working control', () => {
    const props = renderBody({ isStepCompleted: false });
    const skip = screen.getByTestId('tour-btn-skip');
    fireEvent.click(skip);
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it('turns the primary control into a live Continue once the step is done', () => {
    const props = renderBody({ isStepCompleted: true });
    expect(screen.queryByTestId('tour-btn-skip')).toBeNull();
    const primary = screen.getByTestId('tour-btn-next');
    expect(primary).not.toBeDisabled();
    fireEvent.click(primary);
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it('offers Finish instead of Continue when every step is done', () => {
    const props = renderBody({ isStepCompleted: true, allCompleted: true });
    fireEvent.click(screen.getByTestId('tour-btn-finish'));
    expect(props.onComplete).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('tour-btn-next')).toBeNull();
  });
});
