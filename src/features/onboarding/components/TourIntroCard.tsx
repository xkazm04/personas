import { Compass } from 'lucide-react';
import { getTourById, type TourId } from '@/stores/slices/system/tourSlice';
import { getStepColors } from './tourConstants';
import { useTranslation } from '@/i18n/useTranslation';

interface TourIntroCardProps {
  tourId: TourId;
  stepCount: number;
}

/**
 * Brief "what you'll learn" card shown at the top of a tour's first step when no
 * progress has been made yet. Surfaces the tour's one-line description — which is
 * otherwise only visible in the Learning center — plus a step count, so a user who
 * just launched the tour knows its scope before diving in. It disappears once the
 * first step is completed or skipped (progress > 0).
 */
export function TourIntroCard({ tourId, stepCount }: TourIntroCardProps) {
  const { t, tx } = useTranslation();
  const tourDef = getTourById(tourId);
  if (!tourDef) return null;
  const colors = getStepColors(tourDef.color);

  return (
    <div
      data-testid="tour-intro-card"
      className={`mt-2 mb-3 rounded-modal ${colors.subtle} border ${colors.accent} p-3`}
    >
      <div className="flex items-center gap-2">
        <Compass className={`w-3.5 h-3.5 ${colors.text} flex-shrink-0`} />
        <span className={`typo-heading ${colors.text}`}>{t.onboarding.tour_intro_heading}</span>
      </div>
      <p className="typo-body text-foreground leading-relaxed mt-1.5">{tourDef.description}</p>
      <p className="typo-caption text-foreground mt-2">
        {tx(t.onboarding.tour_intro_steps, { count: stepCount })}
      </p>
    </div>
  );
}
