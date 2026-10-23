import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('../useTourNarration', () => ({
  useTourNarration: () => ({ available: false, status: 'idle', muted: false, toggleMute: vi.fn(), replay: vi.fn() }),
}));
vi.mock('../TourNarrationButton', () => ({ TourNarrationButton: () => null }));
vi.mock('../TourNarrativeDeck', () => ({ TourNarrativeDeck: () => null }));

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import { useTourStore } from '@/stores/tourStore';
import { useSystemStore } from '@/stores/systemStore';
import { getActiveTourSteps } from '@/stores/slices/system/tourSlice';
import GuidedTour from '../GuidedTour';

const TOUR = 'execution-observability' as const;

function persistedIndex(): number | undefined {
  const raw = localStorage.getItem('guided-tour-state');
  if (!raw) return undefined;
  const parsed: { tours?: Record<string, { currentStepIndex?: number }> } = JSON.parse(raw);
  return parsed.tours?.[TOUR]?.currentStepIndex;
}

describe('GuidedTour Back goes through the store step door', () => {
  beforeEach(() => {
    localStorage.clear();
    useSystemStore.setState({ onboardingActive: false });
  });

  it('Back persists the new position and drops the later step spotlight', () => {
    const steps = getActiveTourSteps(TOUR);
    const anchorOf = (i: number) =>
      steps[i]!.highlightTestId ?? steps[i]!.subSteps.find((x) => x.highlightTestId)?.highlightTestId ?? null;
    // A step with no anchor of its own, followed by one whose spotlight is up.
    const back = steps.findIndex(
      (s, i) => i + 1 < steps.length && !s.highlightTestId && !s.subSteps[0]?.highlightTestId
        && anchorOf(i + 1) !== null,
    );
    expect(back).toBeGreaterThanOrEqual(0);

    useTourStore.setState({
      tourActive: true,
      tourResumePending: false,
      tourActiveTourId: TOUR,
      tourCurrentStepIndex: back + 1,
      tourSubStepIndex: 0,
      tourHighlightTestId: anchorOf(back + 1),
    });
    render(<GuidedTour />);

    fireEvent.click(screen.getByTestId('tour-btn-prev'));

    const s = useTourStore.getState();
    expect(s.tourCurrentStepIndex).toBe(back);
    expect(s.tourHighlightTestId).toBeNull();
    expect(persistedIndex()).toBe(back);
  });
});
