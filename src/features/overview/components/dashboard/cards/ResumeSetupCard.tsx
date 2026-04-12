import { RotateCcw, ArrowRight, X } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useShallow } from 'zustand/react/shallow';
import { TOUR_STEPS } from '@/stores/slices/system/tourSlice';
import { useTranslation } from '@/i18n/useTranslation';

export default function ResumeSetupCard() {
  const { t } = useTranslation();
  const {
    tourActive,
    tourCompleted,
    tourDismissed,
    tourStepCompleted,
    tourCurrentStepIndex,
  } = useSystemStore(useShallow((s) => ({
    tourActive: s.tourActive,
    tourCompleted: s.tourCompleted,
    tourDismissed: s.tourDismissed,
    tourStepCompleted: s.tourStepCompleted,
    tourCurrentStepIndex: s.tourCurrentStepIndex,
  })));

  // Only show when tour was dismissed mid-flow
  if (tourActive || tourCompleted || !tourDismissed) return null;

  const completedCount = TOUR_STEPS.filter((s) => tourStepCompleted[s.id]).length;
  const currentStep = TOUR_STEPS[tourCurrentStepIndex];
  const currentStepLabel = currentStep?.title ?? 'Setup';

  const handleResume = () => {
    useSystemStore.setState({ tourDismissed: false });
    setTimeout(() => useSystemStore.getState().startTour(), 50);
  };

  const handleDismiss = () => {
    useSystemStore.getState().finishTour();
  };

  return (
    <div className="animate-fade-slide-in rounded-xl border border-violet-500/20 bg-gradient-to-r from-violet-500/8 to-indigo-500/5 p-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center flex-shrink-0">
          <RotateCcw className="w-5 h-5 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="typo-heading text-foreground/90">{t.overview.resume_setup_card.resume_tour}</h3>
          <p className="typo-body text-muted-foreground/70">
            You left off at <span className="text-violet-400 font-medium">{currentStepLabel}</span>
            {completedCount > 0 && (
              <> &mdash; {completedCount}/{TOUR_STEPS.length} steps completed</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleDismiss}
            className="p-2 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/50 hover:text-foreground/70"
            title={t.overview.resume_setup_card.skip_tour}
          >
            <X className="w-4 h-4" />
          </button>
          <button
            onClick={handleResume}
            className="flex items-center gap-2 px-4 py-2 typo-heading rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors"
          >
            {t.overview.resume_setup_card.continue_label}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
