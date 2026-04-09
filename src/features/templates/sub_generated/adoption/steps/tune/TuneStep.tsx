import { useMemo } from 'react';
import { useAdoptionWizard } from '../../AdoptionWizardContext';
import { ThinkingLoader } from '../../../shared/ThinkingLoader';
import { validateVariable } from '@/lib/utils/sanitizers/variableSanitizer';
import { TemplateVariablesCard } from './TemplateVariablesCard';
import { TriggerSetupCard } from './TriggerSetupCard';
import { HumanReviewCard } from './HumanReviewCard';
import { MemoryCard } from './MemoryCard';
import { AiQuestionsCard } from './AiQuestionsCard';

// -- Component ---------------------------------------------

export function TuneStep() {
  const {
    state,
    wizard,
    designResult,
    adoptionRequirements,
    verification,
  } = useAdoptionWizard();

  const sandboxPolicy = verification.sandboxPolicy;

  const {
    variableValues,
    selectedTriggerIndices,
    triggerConfigs,
    questions,
    userAnswers,
    questionGenerating,
    requireApproval,
    autoApproveSeverity,
    reviewTimeout,
    memoryEnabled,
    memoryScope,
  } = state;

  const hasVariables = adoptionRequirements.length > 0;
  const hasQuestions = questions !== null && questions.length > 0;

  // -- Selected triggers --

  const selectedTriggers = useMemo(() => {
    if (!designResult?.suggested_triggers) return [];
    const all = designResult.suggested_triggers
      .map((t, i) => ({ trigger: t, originalIndex: i }))
      .filter(({ originalIndex }) => selectedTriggerIndices.has(originalIndex));
    // Deduplicate: show only one trigger per type (e.g. one schedule trigger)
    const seenTypes = new Set<string>();
    return all.filter(({ trigger }) => {
      if (seenTypes.has(trigger.trigger_type)) return false;
      seenTypes.add(trigger.trigger_type);
      return true;
    });
  }, [designResult, selectedTriggerIndices]);

  // -- Variable validation summary --

  const hasRequiredMissing = useMemo(() => {
    if (!hasVariables) return false;
    return adoptionRequirements
      .filter((v) => v.required)
      .some((v) => {
        const val = variableValues[v.key] ?? v.default_value ?? '';
        if (!val.trim()) return true;
        const check = validateVariable(val, v);
        return !check.valid;
      });
  }, [hasVariables, adoptionRequirements, variableValues]);

  return (
    <div className="space-y-3">
      {/* Step header */}
      <div className="mb-1">
        <h3 className="text-base font-semibold text-foreground">Customize Persona</h3>
        <p className="text-sm text-foreground mt-0.5">
          Answer questions to tailor the persona to your needs, then configure triggers and policies.
          {hasRequiredMissing && (
            <span className="text-amber-400/70 ml-1">Required fields marked below.</span>
          )}
        </p>
      </div>

      {/* Template Variables */}
      {hasVariables && (
        <TemplateVariablesCard
          adoptionRequirements={adoptionRequirements}
          variableValues={variableValues}
          onUpdateVariable={wizard.updateVariable}
        />
      )}

      {/* Three-column layout: Trigger Setup | Human Review | Memory */}
      <div className="grid grid-cols-1 md:grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-6 gap-4">
        <TriggerSetupCard
          selectedTriggers={selectedTriggers}
          triggerConfigs={triggerConfigs}
          onUpdateTriggerConfig={wizard.updateTriggerConfig}
        />

        <HumanReviewCard
          requireApproval={requireApproval}
          autoApproveSeverity={autoApproveSeverity}
          reviewTimeout={reviewTimeout}
          sandboxPolicy={sandboxPolicy}
          onUpdatePreference={wizard.updatePreference}
        />

        <MemoryCard
          memoryEnabled={memoryEnabled}
          memoryScope={memoryScope}
          onUpdatePreference={wizard.updatePreference}
        />
      </div>

      {/* AI Questions — shown prominently as the primary customization interface */}
      {hasQuestions && (
        <AiQuestionsCard
          questions={questions}
          userAnswers={userAnswers}
          onAnswerUpdated={(questionId, answer) => wizard.answerUpdated(questionId, answer)}
        />
      )}

      {/* Loading indicator for questions generation */}
      {questionGenerating && !hasQuestions && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/5 border border-violet-500/10">
          <ThinkingLoader size={20} />
          <span className="text-sm text-violet-300/70">Analyzing template to generate customization questions...</span>
        </div>
      )}
    </div>
  );
}
