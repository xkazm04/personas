import {
  Check,
  ArrowRight,
  X,
  Sparkles,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { BaseModal } from '@/lib/ui/BaseModal';
import AdoptionWizardModal from '@/features/templates/sub_generated/adoption/AdoptionWizardModal';
import { AppearanceStep } from './AppearanceStep';
import { DesktopDiscoveryStep } from './DesktopDiscoveryStep';
import { TemplatePickerStep } from './TemplatePickerStep';
import { ExecutionStep } from './ExecutionStep';
import { StepIndicator, useSteps } from './StepIndicator';
import { useOnboardingState } from './useOnboardingState';
import { useTranslation } from '@/i18n/useTranslation';

export default function OnboardingOverlay() {
  const {
    onboardingActive,
    onboardingStep,
    onboardingStepCompleted,
    onboardingSelectedReviewId,
    onboardingCreatedPersonaId,
    dismissOnboarding,
    templates,
    templateLoadState,
    retryLoadTemplates,
    showAdoptionWizard,
    isAdopting,
    selectedReview,
    createdPersona,
    discoveredApps,
    isScanning,
    approvedApps,
    approvingApp,
    handleApproveApp,
    handleNextFromAppearance,
    handleNextFromDiscover,
    handleTemplateSelect,
    handleNextFromPick,
    handleAdoptionComplete,
    handleAdoptionClose,
    handleExecutionComplete,
    handleFinish,
  } = useOnboardingState();
  const { t } = useTranslation();
  const steps = useSteps();

  if (!onboardingActive) return null;

  if (showAdoptionWizard && selectedReview) {
    return (
      <AdoptionWizardModal
        isOpen
        onClose={handleAdoptionClose}
        review={selectedReview}
        onPersonaCreated={handleAdoptionComplete}
      />
    );
  }

  return (
    <BaseModal
      isOpen
      onClose={dismissOnboarding}
      titleId="onboarding-overlay-title"
      maxWidthClass="max-w-2xl"
      panelClassName="max-h-[85vh] bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-modal bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
            <Sparkles className="w-4.5 h-4.5 text-violet-400" />
          </div>
          <div>
            <h2 id="onboarding-overlay-title" className="typo-heading text-foreground/90">
              {t.onboarding.title}
            </h2>
            <p className="typo-body text-foreground">{t.onboarding.subtitle}</p>
          </div>
        </div>
        <button
          onClick={dismissOnboarding}
          className="p-1.5 rounded-card hover:bg-secondary/50 transition-colors text-foreground hover:text-foreground/80"
          title={t.onboarding.skip_tooltip}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Step indicator */}
      <div className="px-6 py-3 border-b border-primary/5 flex-shrink-0">
        <StepIndicator
          steps={steps}
          currentStep={onboardingStep}
          completedSteps={onboardingStepCompleted}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="animate-fade-slide-in"
            key={onboardingStep}
          >
            {onboardingStep === 'appearance' && (
              <AppearanceStep />
            )}

            {onboardingStep === 'discover' && (
              <DesktopDiscoveryStep
                apps={discoveredApps}
                isScanning={isScanning}
                approvedApps={approvedApps}
                approvingApp={approvingApp}
                onApprove={handleApproveApp}
              />
            )}

            {onboardingStep === 'pick-template' && (
              <TemplatePickerStep
                templates={templates}
                loadState={templateLoadState}
                selectedId={onboardingSelectedReviewId}
                onSelect={handleTemplateSelect}
                onRetry={retryLoadTemplates}
              />
            )}

            {onboardingStep === 'adopt' && !showAdoptionWizard && (
              <div className="flex flex-col items-center py-8 gap-4">
                <LoadingSpinner size="xl" className="text-violet-400" />
                <p className="typo-body text-foreground">{t.onboarding.opening_wizard}</p>
              </div>
            )}

            {onboardingStep === 'execute' && onboardingCreatedPersonaId && (
              <ExecutionStep
                personaId={onboardingCreatedPersonaId}
                personaName={createdPersona?.name ?? 'Your Agent'}
                onComplete={handleExecutionComplete}
              />
            )}
          </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-3.5 border-t border-primary/10 bg-secondary/10 flex-shrink-0">
        <button
          onClick={dismissOnboarding}
          className="px-4 py-2 typo-heading rounded-modal border border-primary/15 text-foreground hover:bg-secondary/50 transition-colors"
        >
          {t.onboarding.skip_button}
        </button>

        <div className="flex items-center gap-2">
          {onboardingStep === 'appearance' && (
            <button
              onClick={handleNextFromAppearance}
              className="flex items-center gap-2 px-4 py-2.5 typo-heading rounded-modal bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors"
            >
              {t.onboarding.continue_button}
              <ArrowRight className="w-4 h-4" />
            </button>
          )}

          {onboardingStep === 'discover' && (
            <button
              onClick={handleNextFromDiscover}
              disabled={isScanning}
              title={isScanning ? t.onboarding.scanning_tooltip : undefined}
              className="flex items-center gap-2 px-4 py-2.5 typo-heading rounded-modal bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t.onboarding.continue_button}
              <ArrowRight className="w-4 h-4" />
            </button>
          )}

          {onboardingStep === 'pick-template' && (
            <button
              onClick={handleNextFromPick}
              disabled={!onboardingSelectedReviewId || templates.length === 0 || isAdopting}
              title={!onboardingSelectedReviewId ? t.onboarding.select_template_tooltip : undefined}
              className="flex items-center gap-2 px-4 py-2.5 typo-heading rounded-modal bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t.onboarding.adopt_button}
              <ArrowRight className="w-4 h-4" />
            </button>
          )}

          {onboardingStep === 'execute' && onboardingStepCompleted['execute'] && (
            <button
              onClick={handleFinish}
              className="flex items-center gap-2 px-4 py-2.5 typo-heading rounded-modal bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors"
            >
              <Check className="w-4 h-4" />
              {t.onboarding.done_button}
            </button>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
