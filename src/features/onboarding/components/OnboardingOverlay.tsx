import type { ReactNode } from 'react';
import {
  Check,
  ArrowRight,
  X,
  Sparkles,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import Button, { type ButtonTone } from '@/features/shared/components/buttons/Button';
import { BaseModal } from '@/lib/ui/BaseModal';
import AdoptionWizardModal from '@/features/templates/sub_generated/adoption/AdoptionWizardModal';
import { AppearanceStep } from './AppearanceStep';
import { DesktopDiscoveryStep } from './DesktopDiscoveryStep';
import { TemplatePickerStep } from './TemplatePickerStep';
import { ExecutionStep } from './ExecutionStep';
import { StepIndicator, useSteps } from './StepIndicator';
import { useOnboardingState } from './useOnboardingState';
import { useTranslation } from '@/i18n/useTranslation';

type OnboardingButtonTone = Extract<ButtonTone, 'agent' | 'success'>;

interface OnboardingActionButtonProps {
  onClick: () => void;
  tone: OnboardingButtonTone;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
}

/**
 * Footer action button shared by every step's continue/finish CTA. Keeps the
 * tone-table in one place so a future palette nudge doesn't need to chase
 * five hand-rolled className strings across the file.
 */
function OnboardingActionButton({
  onClick,
  tone,
  children,
  disabled,
  title,
}: OnboardingActionButtonProps) {
  return (
    <Button variant="accent" tone={tone} size="md" onClick={onClick} disabled={disabled} title={title}>
      {children}
    </Button>
  );
}

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
    discoveryState,
    isScanning,
    retryDesktopScan,
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
      panelClassName="max-h-[85vh] bg-background border border-hair rounded-card shadow-elevation-4 overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-hair flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-modal bg-role-agent/15 border border-role-agent/25 flex items-center justify-center">
            <Sparkles className="w-[18px] h-[18px] text-role-agent" />
          </div>
          <div>
            <h2 id="onboarding-overlay-title" className="typo-heading text-ink-1">
              {t.onboarding.title}
            </h2>
            <p className="typo-body text-ink-1">{t.onboarding.subtitle}</p>
          </div>
        </div>
        <Button
          type="button"
          onClick={dismissOnboarding}
          aria-label={t.onboarding.skip_tooltip}
          tooltip={t.onboarding.skip_tooltip}
          variant="ghost"
          size="icon-sm"
          icon={<X className="w-4 h-4" />}
        />
      </div>

      {/* Step indicator */}
      <div className="px-6 py-3 border-b border-hair flex-shrink-0">
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
                scanState={discoveryState}
                approvedApps={approvedApps}
                approvingApp={approvingApp}
                onApprove={handleApproveApp}
                onRetry={retryDesktopScan}
              />
            )}

            {onboardingStep === 'pick-template' && (
              <TemplatePickerStep
                templates={templates}
                loadState={templateLoadState}
                selectedId={onboardingSelectedReviewId}
                approvedApps={approvedApps}
                onSelect={handleTemplateSelect}
                onRetry={retryLoadTemplates}
              />
            )}

            {onboardingStep === 'adopt' && !showAdoptionWizard && (
              <div className="flex flex-col items-center py-8 gap-4">
                <LoadingSpinner size="xl" className="text-role-agent" />
                <p className="typo-body text-ink-1">{t.onboarding.opening_wizard}</p>
              </div>
            )}

            {onboardingStep === 'execute' && onboardingCreatedPersonaId && (
              <ExecutionStep
                personaId={onboardingCreatedPersonaId}
                personaName={createdPersona?.name ?? t.onboarding.your_agent_fallback}
                onComplete={handleExecutionComplete}
              />
            )}
          </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-3.5 border-t border-hair bg-surface-1 flex-shrink-0">
        <Button type="button" onClick={dismissOnboarding} variant="secondary" size="md">{t.onboarding.skip_button}</Button>

        <div className="flex items-center gap-2">
          {onboardingStep === 'appearance' && (
            <OnboardingActionButton onClick={handleNextFromAppearance} tone="agent">
              {t.onboarding.continue_button}
              <ArrowRight className="w-4 h-4" />
            </OnboardingActionButton>
          )}

          {onboardingStep === 'discover' && (
            <OnboardingActionButton
              onClick={handleNextFromDiscover}
              tone="agent"
              disabled={isScanning}
              title={isScanning ? t.onboarding.scanning_tooltip : undefined}
            >
              {t.onboarding.continue_button}
              <ArrowRight className="w-4 h-4" />
            </OnboardingActionButton>
          )}

          {onboardingStep === 'pick-template' && (
            <OnboardingActionButton
              onClick={handleNextFromPick}
              tone="agent"
              disabled={!onboardingSelectedReviewId || templates.length === 0 || isAdopting}
              title={!onboardingSelectedReviewId ? t.onboarding.select_template_tooltip : undefined}
            >
              {t.onboarding.adopt_button}
              <ArrowRight className="w-4 h-4" />
            </OnboardingActionButton>
          )}

          {onboardingStep === 'execute' && onboardingStepCompleted['execute'] && (
            <OnboardingActionButton onClick={handleFinish} tone="success">
              <Check className="w-4 h-4" />
              {t.onboarding.done_button}
            </OnboardingActionButton>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
