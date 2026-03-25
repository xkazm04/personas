import { Map, RotateCcw, Play } from "lucide-react";
import { useSystemStore } from "@/stores/systemStore";
import { TOUR_STEPS } from "@/stores/slices/system/tourSlice";

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
  const resetTour = useSystemStore((s) => s.resetTour);

  if (tourActive) return null;

  const completedCount = Object.values(tourStepCompleted).filter(Boolean).length;
  const totalSteps = TOUR_STEPS.length;
  const canResume = tourDismissed && !tourCompleted && completedCount > 0;

  const handleStart = () => {
    if (tourCompleted) {
      resetTour();
    }
    setTimeout(() => {
      useSystemStore.getState().startTour();
    }, 50);
  };

  const handleResume = () => {
    // Start tour without resetting — it will resume from persisted step
    useSystemStore.setState({ tourDismissed: false });
    setTimeout(() => {
      useSystemStore.getState().startTour();
    }, 50);
  };

  return (
    <button
      onClick={canResume ? handleResume : handleStart}
      className="animate-fade-slide-in flex-shrink-0 flex items-center gap-2 px-4 py-2 typo-heading rounded-xl
        bg-violet-500/10 text-violet-300 border border-violet-500/25
        hover:bg-violet-500/20 hover:border-violet-400/40 hover:shadow-[0_0_16px_rgba(139,92,246,0.15)]
        transition-all duration-300 cursor-pointer"
    >
      {canResume ? (
        <>
          <TourProgressArc completed={completedCount} total={totalSteps} />
          Resume Tour ({completedCount}/{totalSteps})
        </>
      ) : tourCompleted ? (
        <>
          <RotateCcw className="w-3.5 h-3.5" />
          Restart Tour
        </>
      ) : tourDismissed ? (
        <>
          <Play className="w-3.5 h-3.5" />
          Start Tour
        </>
      ) : (
        <>
          <Map className="w-3.5 h-3.5" />
          Start Tour
        </>
      )}
    </button>
  );
}
