import { useCallback } from 'react';
import { Map } from 'lucide-react';
import { getActiveTourSteps } from '@/stores/slices/system/tourSlice';
import { useTourStore } from '@/stores/tourStore';
import { useTranslation } from '@/i18n/useTranslation';

// Resume-tour action — appears only when a guided tour was started, made
// partial progress, and was then dismissed (not completed). Lets the user
// pick the tour back up from the footer without hunting for the launcher.

export default function TourResumeFooterIcon() {
  const { t, tx } = useTranslation();
  const tourActive = useTourStore((s) => s.tourActive);
  const tourDismissed = useTourStore((s) => s.tourDismissed);
  const tourCompleted = useTourStore((s) => s.tourCompleted);
  const tourId = useTourStore((s) => s.tourActiveTourId);
  const stepCompleted = useTourStore((s) => s.tourStepCompleted);

  const steps = getActiveTourSteps(tourId);
  const total = steps.length;
  const done = steps.filter((s) => stepCompleted[s.id]).length;
  const partial = done > 0 && done < total;
  const show = !tourActive && !tourCompleted && tourDismissed && partial;

  const handleClick = useCallback(() => {
    // Resume WITHOUT an aggressive route jump: startTour reactivates the tour,
    // then tourResumePending makes GuidedTour show its "continue where you left
    // off" window first and redirect only after the user confirms.
    useTourStore.getState().startTour(tourId);
    useTourStore.setState({ tourDismissed: false, tourResumePending: true });
  }, [tourId]);

  if (!show) return null;

  // tx() interpolates {completed}/{total} — the label string carries the
  // placeholders, so a plain `t.onboarding.resume_tour` would render them raw.
  const label = tx(t.onboarding.resume_tour, { completed: done, total });
  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="footer-resume-tour"
      className="h-7 px-2 rounded-lg flex items-center gap-1.5 text-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
      title={label}
      aria-label={label}
    >
      <Map className="w-4 h-4" />
      <span className="typo-caption">{done}/{total}</span>
    </button>
  );
}
