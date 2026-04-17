import { useState } from 'react';
import { Shield, Map, RotateCcw, Play, Trash2, Check, AlertTriangle, ScrollText } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useSystemStore } from "@/stores/systemStore";
import { TOUR_STEPS } from '@/stores/slices/system/tourSlice';
import { hasUserConsented, resetUserConsent } from '@/features/shared/components/overlays/FirstUseConsentModal';
import { useTranslation } from '@/i18n/useTranslation';

export default function AdminSettings() {
  const tourActive = useSystemStore((s) => s.tourActive);
  const tourCompleted = useSystemStore((s) => s.tourCompleted);
  const tourDismissed = useSystemStore((s) => s.tourDismissed);
  const tourCurrentStepIndex = useSystemStore((s) => s.tourCurrentStepIndex);
  const tourStepCompleted = useSystemStore((s) => s.tourStepCompleted);
  const resetTour = useSystemStore((s) => s.resetTour);
  const finishTour = useSystemStore((s) => s.finishTour);
  const dismissTour = useSystemStore((s) => s.dismissTour);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  const [confirmReset, setConfirmReset] = useState(false);
  const [consentStatus, setConsentStatus] = useState(hasUserConsented);
  const [confirmConsentReset, setConfirmConsentReset] = useState(false);
  const { t } = useTranslation();
  const s = t.settings.admin;

  const completedCount = TOUR_STEPS.filter((s) => tourStepCompleted[s.id]).length;

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
    ? s.tour_active
    : tourCompleted
      ? s.tour_completed
      : tourDismissed
        ? s.tour_dismissed
        : s.tour_not_started;

  const statusColor = tourActive
    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
    : tourCompleted
      ? 'text-blue-400 bg-blue-500/10 border-blue-500/20'
      : tourDismissed
        ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
        : 'text-foreground bg-secondary/30 border-primary/10';

  return (
    <ContentBox>
      <ContentHeader
        icon={<Shield className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={s.title}
        subtitle={s.subtitle}
      />
      <ContentBody>
        <div className="max-w-2xl 2xl:max-w-4xl 3xl:max-w-5xl 4xl:max-w-6xl mx-auto space-y-6 py-2">
          {/* Section: Guided Tour */}
          <div className="rounded-modal border border-primary/10 bg-secondary/10 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-primary/8">
              <div className="w-9 h-9 rounded-modal bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                <Map className="w-4.5 h-4.5 text-violet-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="typo-heading font-semibold text-foreground/90">{s.guided_tour}</h3>
                <p className="typo-body text-foreground">{s.tour_hint}</p>
              </div>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-card text-[11px] font-semibold border ${statusColor}`}>
                {statusLabel}
              </span>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Tour state summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-card bg-secondary/20 border border-primary/8 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-foreground mb-1">{s.progress}</p>
                  <p className="typo-body font-medium text-foreground">
                    {completedCount} / {TOUR_STEPS.length} {s.steps}
                  </p>
                </div>
                <div className="rounded-card bg-secondary/20 border border-primary/8 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-foreground mb-1">{s.current_step}</p>
                  <p className="typo-body font-medium text-foreground">
                    {tourActive ? TOUR_STEPS[tourCurrentStepIndex]?.title ?? 'N/A' : '--'}
                  </p>
                </div>
              </div>

              {/* Step completion detail */}
              <div className="rounded-card bg-secondary/20 border border-primary/8 p-3">
                <p className="text-[11px] uppercase tracking-wider text-foreground mb-2">{s.step_status}</p>
                <div className="space-y-1.5">
                  {TOUR_STEPS.map((step, i) => (
                    <div key={step.id} className="flex items-center gap-2">
                      <div className={`w-5 h-5 rounded-input flex items-center justify-center text-[10px] font-bold ${
                        tourStepCompleted[step.id]
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                          : tourActive && i === tourCurrentStepIndex
                            ? 'bg-violet-500/15 text-violet-400 border border-violet-500/20'
                            : 'bg-secondary/30 text-foreground border border-primary/10'
                      }`}>
                        {tourStepCompleted[step.id] ? <Check className="w-3 h-3" /> : i + 1}
                      </div>
                      <span className={`typo-body ${
                        tourStepCompleted[step.id]
                          ? 'text-emerald-400/80 line-through'
                          : 'text-foreground'
                      }`}>
                        {step.title}
                      </span>
                      <span className="text-[11px] text-foreground ml-auto font-mono">
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
                  className="flex items-center gap-2 px-4 py-2 typo-body font-medium rounded-modal
                    bg-violet-500/15 text-violet-300 border border-violet-500/25
                    hover:bg-violet-500/25 transition-colors"
                >
                  <Play className="w-3.5 h-3.5" />
                  {s.force_start}
                </button>

                <button
                  onClick={handleReset}
                  className={`flex items-center gap-2 px-4 py-2 typo-body font-medium rounded-modal border transition-colors ${
                    confirmReset
                      ? 'bg-red-500/15 text-red-300 border-red-500/25 hover:bg-red-500/25'
                      : 'bg-secondary/30 text-foreground border-primary/15 hover:bg-secondary/50 hover:text-foreground/70'
                  }`}
                >
                  {confirmReset ? (
                    <>
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {s.confirm_reset}
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-3.5 h-3.5" />
                      {s.reset_state}
                    </>
                  )}
                </button>

                {tourActive && (
                  <>
                    <button
                      onClick={() => finishTour()}
                      className="flex items-center gap-2 px-4 py-2 typo-body font-medium rounded-modal
                        bg-emerald-500/10 text-emerald-400 border border-emerald-500/20
                        hover:bg-emerald-500/20 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {s.force_complete}
                    </button>
                    <button
                      onClick={() => dismissTour()}
                      className="flex items-center gap-2 px-4 py-2 typo-body font-medium rounded-modal
                        bg-amber-500/10 text-amber-400 border border-amber-500/20
                        hover:bg-amber-500/20 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {s.force_dismiss}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
          {/* Section: User Consent */}
          <div className="rounded-modal border border-primary/10 bg-secondary/10 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-primary/8">
              <div className="w-9 h-9 rounded-modal bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                <ScrollText className="w-4.5 h-4.5 text-cyan-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="typo-heading font-semibold text-foreground/90">{s.user_consent}</h3>
                <p className="typo-body text-foreground">{s.consent_hint}</p>
              </div>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-card text-[11px] font-semibold border ${
                consentStatus
                  ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                  : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
              }`}>
                {consentStatus ? s.consent_accepted : s.consent_not_accepted}
              </span>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="rounded-card bg-secondary/20 border border-primary/8 p-3">
                <p className="text-[11px] uppercase tracking-wider text-foreground mb-1">{s.storage_key}</p>
                <p className="typo-code font-mono text-foreground">__personas_user_consent_accepted</p>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => {
                    if (!confirmConsentReset) {
                      setConfirmConsentReset(true);
                      setTimeout(() => setConfirmConsentReset(false), 3000);
                      return;
                    }
                    resetUserConsent();
                    setConsentStatus(false);
                    setConfirmConsentReset(false);
                  }}
                  className={`flex items-center gap-2 px-4 py-2 typo-body font-medium rounded-modal border transition-colors ${
                    confirmConsentReset
                      ? 'bg-red-500/15 text-red-300 border-red-500/25 hover:bg-red-500/25'
                      : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20'
                  }`}
                >
                  {confirmConsentReset ? (
                    <>
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {s.confirm_reset}
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-3.5 h-3.5" />
                      {s.reset_consent}
                    </>
                  )}
                </button>

                {!consentStatus && (
                  <button
                    onClick={() => window.location.reload()}
                    className="flex items-center gap-2 px-4 py-2 typo-body font-medium rounded-modal
                      bg-amber-500/10 text-amber-400 border border-amber-500/20
                      hover:bg-amber-500/20 transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" />
                    {s.reload_modal}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
