import { useMemo, useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  X,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  RefreshCw,
  Check,
  Wand2,
} from 'lucide-react';
import {
  CREATE_TEMPLATE_STEPS,
  CREATE_TEMPLATE_STEP_META,
} from '../useCreateTemplateReducer';
import { WizardStepper } from '@/features/shared/components/progress/WizardStepper';
import { BaseModal } from '../../shared/BaseModal';
import type { CreateTemplateModalProps } from './createTemplateTypes';
import { useCreateTemplateActions } from '../useCreateTemplateActions';
import { DescribeStep, GenerateStep, ReviewStep } from './CreateTemplateSteps';

export type { CreateTemplateModalProps } from './createTemplateTypes';

export function CreateTemplateModal({
  isOpen,
  onClose,
  onTemplateCreated,
}: CreateTemplateModalProps) {
  const {
    state,
    reducer,
    handleStartGenerate,
    handleCancel,
    handleRetry,
    handleSaveTemplate,
    updateDraft,
    handleApplyAdjustment,
    handleClose: actionClose,
  } = useCreateTemplateActions(isOpen, onTemplateCreated);

  // -- Close handler --
  const handleClose = useCallback(() => {
    actionClose();
    onClose();
  }, [actionClose, onClose]);

  // -- Navigation --
  const canGoBack = state.step !== 'describe' && !state.generating && !state.saving;

  const handleBack = useCallback(() => {
    if (!canGoBack) return;
    if (state.step === 'review') reducer.goToStep('describe');
    else if (state.step === 'generate' && !state.generating) reducer.goToStep('describe');
  }, [canGoBack, state.step, state.generating, reducer]);

  // -- Step indicator --
  const createWizardSteps = useMemo(
    () => CREATE_TEMPLATE_STEPS.map((s) => ({ key: s, label: CREATE_TEMPLATE_STEP_META[s].label })),
    [],
  );
  const createStepIndex = CREATE_TEMPLATE_STEP_META[state.step].index;

  if (!isOpen) return null;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      titleId="create-template-title"
      maxWidthClass="max-w-3xl"
      panelClassName="max-h-[85vh] bg-background border border-primary/15 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden"
    >
      <div
        className="animate-fade-slide-in relative h-full flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Wand2 className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h2 id="create-template-title" className="text-base font-semibold text-foreground/80">Create Template</h2>
              <p className="text-sm text-muted-foreground/80">Design a reusable persona template with AI</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <WizardStepper steps={createWizardSteps} currentIndex={createStepIndex} />
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg hover:bg-secondary/60 transition-colors"
            >
              <X className="w-4 h-4 text-muted-foreground/90" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {state.step === 'describe' && (
              <DescribeStep
                templateName={state.templateName}
                description={state.description}
                error={state.error ?? ''}
                reducer={reducer}
              />
            )}

            {state.step === 'generate' && (
              <GenerateStep
                generateLines={state.generateLines}
                generatePhase={state.generatePhase}
                backgroundGenId={state.backgroundGenId}
                onRetry={handleRetry}
                onCancel={handleCancel}
              />
            )}

            {state.step === 'review' && state.draft && (
              <ReviewStep
                draft={state.draft}
                draftJson={state.draftJson}
                draftJsonError={state.draftJsonError ?? ''}
                adjustmentRequest={state.adjustmentRequest}
                transforming={state.transforming}
                saving={state.saving}
                saved={state.saved}
                updateDraft={updateDraft}
                reducer={reducer}
                onApplyAdjustment={handleApplyAdjustment}
              />
            )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-primary/10 bg-secondary/10 flex-shrink-0">
          <button
            onClick={handleBack}
            disabled={!canGoBack}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>

          <div className="flex items-center gap-3">
            {state.error && state.step !== 'describe' && (
              <span className="text-sm text-red-400/80 max-w-[300px] truncate">
                {state.error}
              </span>
            )}

            {state.step === 'describe' && (
              <button
                onClick={handleStartGenerate}
                disabled={!state.templateName.trim() || !state.description.trim()}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border bg-violet-500/15 text-violet-300 border-violet-500/25 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                Generate Template
              </button>
            )}

            {state.step === 'generate' && state.generatePhase === 'completed' && (
              <button
                onClick={() => reducer.goToStep('review')}
                disabled={!state.draft}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border bg-violet-500/15 text-violet-300 border-violet-500/25 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ArrowRight className="w-4 h-4" />
                View Draft
              </button>
            )}

            {state.step === 'review' && !state.saved && (
              <button
                onClick={handleSaveTemplate}
                disabled={state.saving || !state.draft}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border bg-emerald-500/15 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {state.saving ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Saving...</>
                ) : (
                  <><Check className="w-4 h-4" /> Save Template</>
                )}
              </button>
            )}

            {state.step === 'review' && state.saved && (
              <span className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-emerald-400">
                <Check className="w-4 h-4" />
                Template Saved
              </span>
            )}
          </div>
        </div>
      </div>
    </BaseModal>
  );
}
