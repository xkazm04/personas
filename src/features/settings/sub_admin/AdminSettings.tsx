import { useState } from 'react';
import { Shield, Map, RotateCcw, Play, Trash2, Check, AlertTriangle } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useSystemStore } from "@/stores/systemStore";
import { getActiveTourSteps } from '@/stores/slices/system/tourSlice';

export default function AdminSettings() {
  const tourActive = useSystemStore((s) => s.tourActive);
  const tourCompleted = useSystemStore((s) => s.tourCompleted);
  const tourDismissed = useSystemStore((s) => s.tourDismissed);
  const tourCurrentStepIndex = useSystemStore((s) => s.tourCurrentStepIndex);
  const tourStepCompleted = useSystemStore((s) => s.tourStepCompleted);
  const tourActiveTourId = useSystemStore((s) => s.tourActiveTourId);
  const resetTour = useSystemStore((s) => s.resetTour);
  const finishTour = useSystemStore((s) => s.finishTour);
  const dismissTour = useSystemStore((s) => s.dismissTour);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  const [confirmReset, setConfirmReset] = useState(false);

  const activeTourSteps = getActiveTourSteps(tourActiveTourId);
  const completedCount = activeTourSteps.filter((s) => tourStepCompleted[s.id]).length;

  const handleForceStart = () => {
    resetTour();
    setTimeout(() => {
      // After reset, startTour guard checks tourCompleted/tourDismissed.
      // Since we just reset, those are false, so we can start directly.
      useSystemStore.getState().startTour();
      setSidebarSection('home');
    }, 50);
  };

  const handleReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3000);
      return;
    }
    resetTour();
    setConfirmReset(false);
  };

  const statusLabel = tourActive
    ? 'Active'
    : tourCompleted
      ? 'Completed'
      : tourDismissed
        ? 'Dismissed'
        : 'Not started';

  const statusColor = tourActive
    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
    : tourCompleted
      ? 'text-blue-400 bg-blue-500/10 border-blue-500/20'
      : tourDismissed
        ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
        : 'text-muted-foreground/60 bg-secondary/30 border-primary/10';

  return (
    <ContentBox>
      <ContentHeader
        icon={<Shield className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Admin"
        subtitle="Development tools and testing utilities"
      />
      <ContentBody>
        <div className="max-w-2xl mx-auto space-y-6 py-2">
          {/* Section: Guided Tour */}
          <div className="rounded-xl border border-primary/10 bg-secondary/10 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-primary/8">
              <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                <Map className="w-4.5 h-4.5 text-violet-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-foreground/90">Guided Tour</h3>
                <p className="text-sm text-muted-foreground/50">Force-start or reset the onboarding tour for e2e testing</p>
              </div>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${statusColor}`}>
                {statusLabel}
              </span>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Tour state summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-secondary/20 border border-primary/8 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-1">Progress</p>
                  <p className="text-sm font-medium text-foreground/80">
                    {completedCount} / {activeTourSteps.length} steps
                  </p>
                </div>
                <div className="rounded-lg bg-secondary/20 border border-primary/8 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-1">Current Step</p>
                  <p className="text-sm font-medium text-foreground/80">
                    {tourActive ? activeTourSteps[tourCurrentStepIndex]?.title ?? 'N/A' : '--'}
                  </p>
                </div>
              </div>

              {/* Step completion detail */}
              <div className="rounded-lg bg-secondary/20 border border-primary/8 p-3">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">Step Status</p>
                <div className="space-y-1.5">
                  {activeTourSteps.map((step, i) => (
                    <div key={step.id} className="flex items-center gap-2">
                      <div className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
                        tourStepCompleted[step.id]
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                          : tourActive && i === tourCurrentStepIndex
                            ? 'bg-violet-500/15 text-violet-400 border border-violet-500/20'
                            : 'bg-secondary/30 text-muted-foreground/40 border border-primary/10'
                      }`}>
                        {tourStepCompleted[step.id] ? <Check className="w-3 h-3" /> : i + 1}
                      </div>
                      <span className={`text-sm ${
                        tourStepCompleted[step.id]
                          ? 'text-emerald-400/80 line-through'
                          : 'text-foreground/70'
                      }`}>
                        {step.title}
                      </span>
                      <span className="text-[11px] text-muted-foreground/60 ml-auto font-mono">
                        {step.id}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleForceStart}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl
                    bg-violet-500/15 text-violet-300 border border-violet-500/25
                    hover:bg-violet-500/25 transition-colors"
                >
                  <Play className="w-3.5 h-3.5" />
                  Force Start Tour
                </button>

                <button
                  onClick={handleReset}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border transition-colors ${
                    confirmReset
                      ? 'bg-red-500/15 text-red-300 border-red-500/25 hover:bg-red-500/25'
                      : 'bg-secondary/30 text-muted-foreground/60 border-primary/15 hover:bg-secondary/50 hover:text-foreground/70'
                  }`}
                >
                  {confirmReset ? (
                    <>
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Confirm Reset
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset State
                    </>
                  )}
                </button>

                {tourActive && (
                  <>
                    <button
                      onClick={() => finishTour()}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl
                        bg-emerald-500/10 text-emerald-400 border border-emerald-500/20
                        hover:bg-emerald-500/20 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Force Complete
                    </button>
                    <button
                      onClick={() => dismissTour()}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl
                        bg-amber-500/10 text-amber-400 border border-amber-500/20
                        hover:bg-amber-500/20 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Force Dismiss
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
