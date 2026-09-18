import { describe, it, expect, beforeEach, vi } from 'vitest';

import { useSystemStore } from '@/stores/systemStore';
import { useTourStore } from '@/stores/tourStore';

/**
 * `TourHandoffOffer` is the bridge from the first-run overlay to the guided
 * tour, and only `finishOnboarding` ever fired it. Skipping the overlay - the
 * user who by definition has seen the least first-run guidance - recorded a
 * step and offered nothing, and with the production Welcome band unmounted the
 * tour was reachable only from the footer launcher.
 */
describe('tour handoff after the onboarding overlay', () => {
  beforeEach(() => {
    localStorage.clear();
    useSystemStore.setState({
      onboardingActive: true,
      onboardingCompleted: false,
      onboardingStep: 'appearance',
      onboardingDismissedAtStep: null,
      onboardingCreatedPersonaId: null,
      tourHandoffOffered: false,
      tourHandoffVisible: false,
    });
    useTourStore.setState({ tourCompletionMap: {} as never, startTour: vi.fn() as never });
  });

  it('offers the tour when the overlay is skipped, with no persona created', () => {
    useSystemStore.getState().dismissOnboarding();
    const s = useSystemStore.getState();
    expect(s.tourHandoffVisible).toBe(true);
    // Dismissing the overlay is still a deferral, not a completion.
    expect(s.onboardingCompleted).toBe(false);
    expect(s.onboardingDismissedAtStep).toBe('appearance');
  });

  it('does not spend the one-time offer until the card is answered', () => {
    useSystemStore.getState().dismissOnboarding();
    expect(useSystemStore.getState().tourHandoffOffered).toBe(false);

    useSystemStore.getState().dismissTourHandoff();
    const s = useSystemStore.getState();
    expect(s.tourHandoffVisible).toBe(false);
    expect(s.tourHandoffOffered).toBe(true);
  });

  it('never re-offers once refused', () => {
    useSystemStore.getState().dismissOnboarding();
    useSystemStore.getState().dismissTourHandoff();

    useSystemStore.setState({ onboardingActive: true, onboardingStep: 'discover' });
    useSystemStore.getState().dismissOnboarding();
    expect(useSystemStore.getState().tourHandoffVisible).toBe(false);
  });

  it('accepting starts the tour and retires the offer', () => {
    const startTour = vi.fn();
    useTourStore.setState({ startTour: startTour as never });

    useSystemStore.getState().dismissOnboarding();
    useSystemStore.getState().acceptTourHandoff('getting-started');

    expect(startTour).toHaveBeenCalledWith('getting-started', {
      preCompletedSteps: ['persona-creation'],
    });
    expect(useSystemStore.getState().tourHandoffVisible).toBe(false);
    expect(useSystemStore.getState().tourHandoffOffered).toBe(true);
  });

  it('still requires a live agent for the completion handoff', () => {
    useSystemStore.setState({ onboardingCreatedPersonaId: null });
    useSystemStore.getState().offerTourHandoff('completed');
    expect(useSystemStore.getState().tourHandoffVisible).toBe(false);
  });
});
