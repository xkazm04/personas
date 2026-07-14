import { Map, X } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import type { TourId } from '@/stores/slices/system/tourSlice';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

/**
 * One-time handoff card shown after the first-run onboarding modal completes
 * with a live first agent. The modal (adopt a template) and the getting-started
 * tour (build from intent) are two parallel first-runs; without a handoff a
 * fresh user gets taught agent creation twice. This bridges them exactly once:
 * accept starts the tour modal-aware (the redundant "create your first agent"
 * step is carried over as done); dismiss falls back to the footer launcher.
 *
 * Visibility + the never-re-offer guarantee live in onboardingSlice
 * (`tourHandoffVisible` / persisted `tourHandoffOffered`); this component is
 * pure presentation. Self-guards on visibility, so it's safe to mount
 * unconditionally in the global-overlay group.
 */
export default function TourHandoffOffer() {
  const { t } = useTranslation();
  const visible = useSystemStore((s) => s.tourHandoffVisible);
  const acceptTourHandoff = useSystemStore((s) => s.acceptTourHandoff);
  const dismissTourHandoff = useSystemStore((s) => s.dismissTourHandoff);
  const { isStarter } = useTier();

  if (!visible) return null;

  // Match TourLauncher's tier split so the handoff opens the same flavor the
  // footer would.
  const tourId: TourId = isStarter ? 'getting-started-simple' : 'getting-started';

  return (
    <div
      role="region"
      aria-labelledby="tour-handoff-title"
      data-testid="tour-handoff-offer"
      className="animate-fade-slide-in fixed bottom-6 left-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2
        rounded-modal border border-violet-500/25 bg-background p-5 shadow-elevation-4"
    >
      <button
        onClick={dismissTourHandoff}
        aria-label={t.onboarding.tour_handoff_dismiss}
        title={t.onboarding.tour_handoff_dismiss}
        className="absolute right-3 top-3 rounded-card p-1.5 text-foreground transition-colors hover:bg-secondary/50 hover:text-foreground/80"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-modal border border-violet-500/25 bg-violet-500/15">
          <Map className="h-[18px] w-[18px] text-violet-400" />
        </div>
        <div className="min-w-0 flex-1 pr-6">
          <h3 id="tour-handoff-title" className="typo-heading text-foreground/90">
            {t.onboarding.tour_handoff_title}
          </h3>
          <p className="typo-body mt-1 text-foreground">{t.onboarding.tour_handoff_body}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="secondary" size="md" onClick={dismissTourHandoff}>
          {t.onboarding.tour_handoff_dismiss}
        </Button>
        <Button
          variant="accent"
          accentColor="violet"
          size="md"
          onClick={() => acceptTourHandoff(tourId)}
          data-testid="tour-handoff-accept"
          icon={<Map className="h-4 w-4" />}
        >
          {t.onboarding.tour_handoff_accept}
        </Button>
      </div>
    </div>
  );
}
