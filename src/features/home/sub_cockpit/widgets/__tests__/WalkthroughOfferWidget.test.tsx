import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const composeTour = vi.fn();
const ingestComposedTour = vi.fn();
const startTour = vi.fn();
const startGuidance = vi.fn();
const setPendingPrompt = vi.fn();

vi.mock('@/stores/slices/system/dynamicTours', () => ({
  composeTour: (...args: unknown[]) => composeTour(...args),
  ingestComposedTour: (...args: unknown[]) => ingestComposedTour(...args),
}));

vi.mock('@/stores/tourStore', () => {
  const hook = () => undefined;
  (hook as unknown as { getState: () => unknown }).getState = () => ({ startTour });
  return { useTourStore: hook };
});

vi.mock('@/features/plugins/companion/companionStore', () => {
  const hook = () => undefined;
  (hook as unknown as { getState: () => unknown }).getState = () => ({
    startGuidance,
    setPendingPrompt,
  });
  return { useCompanionStore: hook };
});

import { WalkthroughOfferWidget } from '../WalkthroughOfferWidget';

/**
 * This widget WRITES product state - it composes a tour, ingests it and starts
 * it - and the suite it lives in had no file for it. Compose failure is the
 * path that matters: a broken tour must never play, and the read-instead escape
 * has to survive the failure.
 */
describe('WalkthroughOfferWidget compose path', () => {
  beforeEach(() => {
    cleanup();
    composeTour.mockReset();
    ingestComposedTour.mockReset();
    startTour.mockReset();
    startGuidance.mockReset();
    setPendingPrompt.mockReset();
  });

  // A topic with no static walkthrough is the Generative Tours branch.
  const TOPIC = 'some-topic-with-no-static-walkthrough';

  it('renders nothing without a topic', () => {
    const { container } = render(<WalkthroughOfferWidget config={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the composing ghost and then starts the composed tour', async () => {
    composeTour.mockResolvedValueOnce({ id: 'rec-1' });
    ingestComposedTour.mockReturnValueOnce('athena-abc');

    render(<WalkthroughOfferWidget config={{ topic: TOPIC, summary: 'do the thing' }} />);
    fireEvent.click(screen.getByTestId('companion-walkthrough-offer-show'));

    expect(screen.getByTestId('companion-walkthrough-composing')).toBeInTheDocument();
    await waitFor(() => {
      expect(startTour).toHaveBeenCalledWith('athena-abc');
    });
  });

  it('keeps the read-instead escape when composition fails, and never starts a tour', async () => {
    composeTour.mockRejectedValueOnce(new Error('anchor manifest drifted'));

    render(<WalkthroughOfferWidget config={{ topic: TOPIC }} />);
    fireEvent.click(screen.getByTestId('companion-walkthrough-offer-show'));

    await waitFor(() => {
      expect(screen.getByTestId('companion-walkthrough-compose-failed')).toBeInTheDocument();
    });
    expect(startTour).not.toHaveBeenCalled();
    // The "just tell me" path stays available - a failed tour is not a dead end.
    expect(screen.getByTestId('companion-walkthrough-offer-tell')).toBeInTheDocument();
    // And the Show control is gone, so the failure cannot be clicked past.
    expect(screen.queryByTestId('companion-walkthrough-offer-show')).toBeNull();
  });

  it('treats an unvalidatable composed record as a failure, not a playable tour', async () => {
    composeTour.mockResolvedValueOnce({ id: 'rec-2' });
    ingestComposedTour.mockReturnValueOnce(null);

    render(<WalkthroughOfferWidget config={{ topic: TOPIC }} />);
    fireEvent.click(screen.getByTestId('companion-walkthrough-offer-show'));

    await waitFor(() => {
      expect(screen.getByTestId('companion-walkthrough-compose-failed')).toBeInTheDocument();
    });
    expect(startTour).not.toHaveBeenCalled();
  });

  it('seeds a chat turn instead of a tour on "just tell me"', () => {
    render(<WalkthroughOfferWidget config={{ topic: TOPIC }} />);
    fireEvent.click(screen.getByTestId('companion-walkthrough-offer-tell'));
    expect(setPendingPrompt).toHaveBeenCalledTimes(1);
    expect(setPendingPrompt.mock.calls[0][0]).toMatchObject({ autoSend: true });
    expect(startTour).not.toHaveBeenCalled();
  });
});
