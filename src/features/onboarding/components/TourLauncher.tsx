import { Map } from "lucide-react";
import { useSystemStore } from "@/stores/systemStore";
import { getActiveTourSteps } from "@/stores/slices/system/tourSlice";
import { useOnboardingTranslation } from '@/features/onboarding/i18n/useOnboardingTranslation';

function TourProgressArc({ completed, total }: { completed: number; total: number }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? completed / total : 0;
  const dashOffset = circumference * (1 - progress);

  return (
    <svg width={20} height={20} viewBox="0 0 20 20" className="flex-shrink-0">
      <circle
        cx={10}
        cy={10}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        opacity={0.2}
      />
      <circle
        cx={10}
        cy={10}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform="rotate(-90 10 10)"
        className="transition-all duration-300"
      />
    </svg>
  );
}

export default function TourLauncher() {
  const tourCompleted = useSystemStore((s) => s.tourCompleted);
  const tourDismissed = useSystemStore((s) => s.tourDismissed);
  const tourActive = useSystemStore((s) => s.tourActive);
  const tourStepCompleted = useSystemStore((s) => s.tourStepCompleted);
  const tourId = useSystemStore((s) => s.tourActiveTourId);

  const { t } = useOnboardingTranslation();
  const tt = t.tour;

  // Hide when tour is active (it's running) or fully completed
  if (tourActive || tourCompleted) return null;

  const activeTourStepIds = new Set(getActiveTourSteps(tourId).map((s) => s.id));
  const completedCount = Object.entries(tourStepCompleted).filter(([id, done]) => done && activeTourStepIds.has(id)).length;
  const totalSteps = activeTourStepIds.size;
  const hasProgress = completedCount > 0;

  const handleClick = () => {
    // Always resume from where user left off — don't reset
    if (tourDismissed) {
      useSystemStore.setState({ tourDismissed: false });
    }
    setTimeout(() => {
      useSystemStore.getState().startTour();
    }, 50);
  };

  return (
    <button
      onClick={handleClick}
      data-testid="tour-launcher"
      className="animate-fade-slide-in flex-shrink-0 flex items-center gap-2 px-4 py-2 typo-heading rounded-xl
        bg-violet-500/10 text-violet-300 border border-violet-500/25
        hover:bg-violet-500/20 hover:border-violet-400/40 hover:shadow-[0_0_16px_rgba(139,92,246,0.15)]
        transition-all duration-300 cursor-pointer"
    >
      {hasProgress ? (
        <>
          <TourProgressArc completed={completedCount} total={totalSteps} />
          {tt.resume_tour.replace('{completed}', String(completedCount)).replace('{total}', String(totalSteps))}
        </>
      ) : (
        <>
          <Map className="w-3.5 h-3.5" />
          {tt.start_tour}
        </>
      )}
    </button>
  );
}
