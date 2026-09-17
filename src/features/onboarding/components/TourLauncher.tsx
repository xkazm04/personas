import { Map } from "lucide-react";
import { useSystemStore } from "@/stores/systemStore";
import { useTourStore } from "@/stores/tourStore";
import { getActiveTourSteps, type TourId } from "@/stores/slices/system/tourSlice";
import { useTier } from "@/hooks/utility/interaction/useTier";
import { useTranslation } from '@/i18n/useTranslation';
import { TourProgressArc } from './TourProgressArc';

export default function TourLauncher() {
  const { t, tx } = useTranslation();
  const tourCompleted = useTourStore((s) => s.tourCompleted);
  const tourDismissed = useTourStore((s) => s.tourDismissed);
  const tourActive = useTourStore((s) => s.tourActive);
  const tourStepCompleted = useTourStore((s) => s.tourStepCompleted);
  const tourActiveTourId = useTourStore((s) => s.tourActiveTourId);
  const tourCompletionMap = useTourStore((s) => s.tourCompletionMap);
  // Onboarding modal owns the screen — see precedence contract in
  // `src/features/onboarding/README.md`. While the welcome modal is
  // open we hide the launcher button so the user only sees one
  // first-run affordance at a time.
  const onboardingActive = useSystemStore((s) => s.onboardingActive);
  const { isStarter } = useTier();

  // Hide when tour is active (it's running), fully completed, or the
  // onboarding modal is the active first-run surface.
  if (tourActive || tourCompleted || onboardingActive) return null;

  // Which tour does "Resume" mean? The launcher used to hardcode the tier
  // default, so a user paused halfway through e.g. teams-orchestration was
  // sent into getting-started instead - and the progress arc counted the
  // wrong tour's steps. Resume the tour that is actually in flight; fall back
  // to the tier default when there is nothing to resume.
  const defaultTourId: TourId = isStarter ? "getting-started-simple" : "getting-started";
  const activeSteps = getActiveTourSteps(tourActiveTourId);
  const activeCompleted = activeSteps.filter((s) => tourStepCompleted[s.id]).length;
  const activeIsResumable =
    !tourCompletionMap[tourActiveTourId] &&
    activeSteps.length > 0 &&
    activeCompleted > 0 &&
    activeCompleted < activeSteps.length;
  const tourId: TourId = activeIsResumable ? tourActiveTourId : defaultTourId;
  const steps = activeIsResumable ? activeSteps : getActiveTourSteps(tourId);
  // Count only THIS tour's steps: tourStepCompleted holds the LAST ACTIVE
  // tour's map, so counting all truthy values showed e.g. "Resume 5/4" on
  // the getting-started launcher after finishing a different 5-step tour.
  // (Mirrors GuidedTour's per-tour computation.)
  const completedCount = activeIsResumable
    ? activeCompleted
    : steps.filter((s) => tourStepCompleted[s.id]).length;
  const totalSteps = steps.length;
  const hasProgress = completedCount > 0;

  const handleClick = () => {
    // Always resume from where user left off — don't reset
    if (tourDismissed) {
      useTourStore.setState({ tourDismissed: false });
    }
    setTimeout(() => {
      useTourStore.getState().startTour(tourId);
    }, 50);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="tour-launcher"
      className="animate-fade-slide-in flex-shrink-0 flex items-center gap-2 px-4 py-2 typo-heading rounded-modal
        bg-violet-500/10 text-violet-300 border border-violet-500/25
        hover:bg-violet-500/20 hover:border-violet-400/40 hover:shadow-[0_0_16px_rgba(139,92,246,0.15)]
        transition-all duration-300 cursor-pointer"
    >
      {hasProgress ? (
        <>
          <TourProgressArc completed={completedCount} total={totalSteps} />
          {tx(t.onboarding.resume_tour, { completed: completedCount, total: totalSteps })}
        </>
      ) : (
        <>
          <Map className="w-3.5 h-3.5" />
          {t.onboarding.start_tour}
        </>
      )}
    </button>
  );
}
