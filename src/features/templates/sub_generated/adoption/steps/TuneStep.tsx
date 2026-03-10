import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Sliders, Zap, Sparkles, ShieldCheck, Lock, AlertCircle, Brain, Clock, Webhook, MousePointerClick, Radio, Activity } from 'lucide-react';
import { N8nQuestionStepper } from '@/features/templates/sub_n8n/N8nQuestionStepper';
import { useAdoptionWizard } from '../AdoptionWizardContext';
import { validateVariable } from '@/lib/utils/variableSanitizer';
import { ThemedSelect } from '@/features/shared/components/ThemedSelect';
import type { AdoptionRequirement, SuggestedTrigger } from '@/lib/types/designTypes';

// â”€â”€ Shared styles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const inputClass = 'w-full px-2.5 py-1.5 bg-background/50 border border-primary/10 rounded-xl text-sm text-foreground/90 placeholder-muted-foreground/30 focus:outline-none focus:border-violet-500/30 transition-colors';
const labelClass = 'block text-sm font-medium text-foreground/80';
const descClass = 'text-sm text-muted-foreground/50 mt-0.5';
const fieldClass = 'space-y-1';
const cardClass = 'rounded-xl border border-primary/10 bg-secondary/20 p-4';

// â”€â”€ Trigger type icon map â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const TRIGGER_ICONS: Record<SuggestedTrigger['trigger_type'], typeof Clock> = {
  schedule: Clock,
  webhook: Webhook,
  manual: MousePointerClick,
  polling: Radio,
  event: Activity,
};

// â”€â”€ Debounced variable input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Keeps local state for immediate keystroke feedback while debouncing
// the write to the wizard reducer by 300ms. This avoids full
// substituteVariables / filterDesignResult recomputation on every keystroke.

const VARIABLE_DEBOUNCE_MS = 300;

function DebouncedVariableInput({
  variable,
  value: externalValue,
  onUpdate,
  inputClass: cls,
  showError,
}: {
  variable: AdoptionRequirement;
  value: string;
  onUpdate: (key: string, value: string) => void;
  inputClass: string;
  showError: boolean;
}) {
  const [localValue, setLocalValue] = useState(externalValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Sync from external when it changes outside this component (e.g. restore)
  useEffect(() => {
    setLocalValue(externalValue);
  }, [externalValue]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setLocalValue(next);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onUpdate(variable.key, next), VARIABLE_DEBOUNCE_MS);
    },
    [onUpdate, variable.key],
  );

  // Flush pending debounce on unmount
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const inputType =
    variable.type === 'url' ? 'url'
      : variable.type === 'email' ? 'email'
        : 'text';

  const placeholder =
    variable.type === 'cron' ? (variable.default_value ?? '0 9 * * 1-5')
      : variable.type === 'email' ? (variable.default_value ?? 'user@example.com')
        : variable.type === 'url' ? (variable.default_value ?? 'https://...')
          : (variable.default_value ?? '');

  return (
    <input
      type={inputType}
      value={localValue}
      onChange={handleChange}
      placeholder={placeholder}
      className={`${cls} ${showError ? '!border-red-500/30' : ''}`}
    />
  );
}

// â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function TuneStep() {
  const {
    state,
    wizard,
    designResult,
    adoptionRequirements,
    verification,
    handleSkipQuestions,
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

  // â”€â”€ Selected triggers â”€â”€

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

  // â”€â”€ Variable validation summary â”€â”€

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
        <h3 className="text-base font-semibold text-foreground">Configure Persona</h3>
        <p className="text-sm text-muted-foreground/60 mt-0.5">
          Set template variables, triggers, review policy, and memory.
          {hasRequiredMissing && (
            <span className="text-amber-400/70 ml-1">Required fields marked below.</span>
          )}
        </p>
      </div>

      {/* Template Variables â€” simple card */}
      {hasVariables && (
        <div className={cardClass}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-muted-foreground/60"><Sliders className="w-4 h-4" /></span>
            <span className="text-sm font-medium text-foreground/70">Template Configuration</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 3xl:grid-cols-3 gap-3">
            {adoptionRequirements.map((variable) => {
              const value = variableValues[variable.key] ?? variable.default_value ?? '';
              const validation = value.trim() ? validateVariable(value, variable) : null;
              const hasError = validation && !validation.valid;
              const isEmpty = variable.required && !value.trim();
              const showError = hasError || isEmpty;

              return (
                <div key={variable.key} className={fieldClass}>
                  <label className={labelClass}>
                    {variable.label}
                    {variable.required && <span className="text-red-400 ml-0.5">*</span>}
                    {variable.type !== 'text' && variable.type !== 'select' && (
                      <span className="ml-1.5 text-sm text-muted-foreground/60 font-normal">{variable.type}</span>
                    )}
                  </label>
                  {variable.description && <p className={descClass}>{variable.description}</p>}

                  {variable.type === 'select' && variable.options ? (
                    <ThemedSelect
                      value={value}
                      onChange={(e) => wizard.updateVariable(variable.key, e.target.value)}
                      className={`py-1.5 px-2.5 ${showError ? '!border-red-500/30' : ''}`}
                    >
                      <option value="">Select...</option>
                      {variable.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </ThemedSelect>
                  ) : (
                    <DebouncedVariableInput
                      variable={variable}
                      value={value}
                      onUpdate={wizard.updateVariable}
                      inputClass={inputClass}
                      showError={showError}
                    />
                  )}

                  {hasError && (
                    <p className="flex items-center gap-1 text-sm text-red-400/80 mt-0.5">
                      <AlertCircle className="w-3 h-3 flex-shrink-0" />
                      {validation.error}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Three-column layout: Trigger Setup | Human Review | Memory */}
      <div className="grid grid-cols-1 md:grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-6 gap-4">
        {/* Column 1: Trigger Setup */}
        <div className={cardClass}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-amber-400/70"><Zap className="w-4 h-4" /></span>
            <span className="text-sm font-medium text-foreground/70">Trigger Setup</span>
          </div>

          {selectedTriggers.length === 0 ? (
            <p className="text-sm text-muted-foreground/40 italic">No triggers selected</p>
          ) : (
            <div className="flex flex-col gap-3">
              {selectedTriggers.map(({ trigger, originalIndex }) => {
                const Icon = TRIGGER_ICONS[trigger.trigger_type];
                const currentConfig = triggerConfigs[originalIndex] ?? {};

                return (
                  <div key={originalIndex} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Icon className="w-3.5 h-3.5 text-amber-500/70" />
                      <span className="text-sm font-medium text-foreground/80 capitalize">
                        {trigger.trigger_type}
                      </span>
                    </div>
                    {trigger.description && (
                      <p className={descClass}>{trigger.description}</p>
                    )}

                    {trigger.trigger_type === 'schedule' && (
                      <div className={fieldClass}>
                        <label className={labelClass}>When should this run?</label>
                        <input
                          type="text"
                          className={inputClass}
                          placeholder="Every weekday at 9am"
                          value={
                            currentConfig.schedule ??
                            currentConfig.cron ??
                            (trigger.config.cron as string | undefined) ??
                            trigger.description ??
                            ''
                          }
                          onChange={(e) =>
                            wizard.updateTriggerConfig(originalIndex, {
                              ...currentConfig,
                              schedule: e.target.value,
                            })
                          }
                        />
                        <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                          Natural language (e.g. "Every weekday at 9am") or cron (e.g. "0 9 * * 1-5")
                        </p>
                      </div>
                    )}

                    {trigger.trigger_type === 'webhook' && (
                      <div className={fieldClass}>
                        <label className={labelClass}>Webhook URL</label>
                        <input
                          type="text"
                          className={inputClass}
                          placeholder="https://..."
                          value={
                            currentConfig.url ??
                            (trigger.config.url as string | undefined) ??
                            ''
                          }
                          onChange={(e) =>
                            wizard.updateTriggerConfig(originalIndex, {
                              ...currentConfig,
                              url: e.target.value,
                            })
                          }
                        />
                      </div>
                    )}

                    {trigger.trigger_type === 'polling' && (
                      <div className={fieldClass}>
                        <label className={labelClass}>Check interval</label>
                        <input
                          type="text"
                          className={inputClass}
                          placeholder="Every 5 minutes"
                          value={
                            currentConfig.interval ??
                            (trigger.config.interval as string | undefined) ??
                            ''
                          }
                          onChange={(e) =>
                            wizard.updateTriggerConfig(originalIndex, {
                              ...currentConfig,
                              interval: e.target.value,
                            })
                          }
                        />
                      </div>
                    )}

                    {trigger.trigger_type === 'manual' && (
                      <p className="text-sm text-muted-foreground/40 italic">
                        Triggered manually â€” no configuration needed
                      </p>
                    )}

                    {trigger.trigger_type === 'event' && (
                      <p className="text-sm text-muted-foreground/40 italic">
                        Triggered by system events â€” no configuration needed
                      </p>
                    )}

                    {/* Separator between triggers */}
                    {selectedTriggers.length > 1 && originalIndex !== selectedTriggers[selectedTriggers.length - 1]?.originalIndex && (
                      <div className="border-t border-primary/5 mt-1" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Column 2: Human Review */}
        <div className={cardClass}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-violet-400/70"><ShieldCheck className="w-4 h-4" /></span>
            <span className="text-sm font-medium text-foreground/70">Human Review</span>
          </div>

          <div className="flex flex-col gap-3">
            {/* Require approval toggle */}
            <div className={fieldClass}>
              <label className={labelClass}>
                Require approval
                {sandboxPolicy?.requireApproval && (
                  <span className="inline-flex items-center gap-0.5 ml-1.5 text-amber-400/70 text-sm">
                    <Lock className="w-2.5 h-2.5" /> Sandbox
                  </span>
                )}
              </label>
              <p className={descClass}>Pause before executing actions</p>
              <label
                className={`mt-1 inline-flex w-11 h-6 rounded-full border transition-colors items-center cursor-pointer ${
                  requireApproval || sandboxPolicy?.requireApproval
                    ? 'bg-violet-500/30 border-violet-500/40 justify-end'
                    : 'bg-secondary/40 border-primary/15 justify-start'
                } ${sandboxPolicy?.requireApproval ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={requireApproval || !!sandboxPolicy?.requireApproval}
                  checked={requireApproval || !!sandboxPolicy?.requireApproval}
                  disabled={!!sandboxPolicy?.requireApproval}
                  onChange={() => {
                    if (!sandboxPolicy?.requireApproval) {
                      wizard.updatePreference('requireApproval', !requireApproval);
                    }
                  }}
                  className="sr-only"
                />
                <div className={`w-4.5 h-4.5 rounded-full mx-0.5 transition-colors ${
                  requireApproval || sandboxPolicy?.requireApproval ? 'bg-violet-400' : 'bg-muted-foreground/30'
                }`} />
              </label>
            </div>

            {/* Auto-approve severity */}
            <div className={fieldClass}>
              <label className={labelClass}>Auto-approve</label>
              <p className={descClass}>Skip review for lower severity</p>
              <ThemedSelect
                value={autoApproveSeverity}
                onChange={(e) => wizard.updatePreference('autoApproveSeverity', e.target.value)}
                className="py-1.5 px-2.5"
              >
                <option value="info">Info only</option>
                <option value="info_warning">Info + Warning</option>
                <option value="all">All (no review)</option>
              </ThemedSelect>
            </div>

            {/* Review timeout */}
            <div className={fieldClass}>
              <label className={labelClass}>Review timeout</label>
              <p className={descClass}>Auto-reject after timeout</p>
              <ThemedSelect
                value={reviewTimeout}
                onChange={(e) => wizard.updatePreference('reviewTimeout', e.target.value)}
                className="py-1.5 px-2.5"
              >
                <option value="1h">1 hour</option>
                <option value="4h">4 hours</option>
                <option value="24h">24 hours</option>
                <option value="none">No timeout</option>
              </ThemedSelect>
            </div>
          </div>
        </div>

        {/* Column 3: Memory */}
        <div className={cardClass}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-emerald-400/70"><Brain className="w-4 h-4" /></span>
            <span className="text-sm font-medium text-foreground/70">Memory</span>
          </div>

          <p className={`${descClass} mb-3`}>
            Persona retains learned patterns and preferences across runs
          </p>

          <div className="flex flex-col gap-3">
            {/* Memory enabled toggle */}
            <div className={fieldClass}>
              <label className={labelClass}>Memory enabled</label>
              <label
                className={`mt-1 inline-flex w-11 h-6 rounded-full border transition-colors items-center cursor-pointer ${
                  memoryEnabled
                    ? 'bg-emerald-500/30 border-emerald-500/40 justify-end'
                    : 'bg-secondary/40 border-primary/15 justify-start'
                }`}
              >
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={memoryEnabled}
                  checked={memoryEnabled}
                  onChange={() => wizard.updatePreference('memoryEnabled', !memoryEnabled)}
                  className="sr-only"
                />
                <div className={`w-4.5 h-4.5 rounded-full mx-0.5 transition-colors ${
                  memoryEnabled ? 'bg-emerald-400' : 'bg-muted-foreground/30'
                }`} />
              </label>
            </div>

            {/* Memory scope â€” structured categories + custom input (Area #18) */}
            <div className={fieldClass}>
              <label className={labelClass}>Memory scope</label>
              <p className={descClass}>What should the persona remember?</p>
              <ThemedSelect
                value={memoryScope.startsWith('custom:') ? 'custom' : memoryScope || 'all'}
                onChange={(e) => {
                  const val = e.target.value;
                  wizard.updatePreference('memoryScope', val === 'custom' ? 'custom:' : val);
                }}
                className="py-1.5 px-2.5"
                disabled={!memoryEnabled}
              >
                <option value="all">Everything (default)</option>
                <option value="user_preferences">User preferences only</option>
                <option value="execution_patterns">Execution patterns</option>
                <option value="error_resolutions">Error resolutions</option>
                <option value="custom">Custom scope...</option>
              </ThemedSelect>
              {memoryScope.startsWith('custom:') && (
                <input
                  type="text"
                  value={memoryScope.replace('custom:', '')}
                  onChange={(e) => wizard.updatePreference('memoryScope', `custom:${e.target.value}`)}
                  placeholder="Describe what to remember..."
                  className={`${inputClass} mt-1.5`}
                  disabled={!memoryEnabled}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* AI Questions â€” single unified question flow (Phase B)
           Template adoption_questions are now passed as context to the LLM,
           which decides what to ask during the Build step. */}
      {hasQuestions && (
        <div className={cardClass}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-violet-400/70"><Sparkles className="w-4 h-4" /></span>
              <span className="text-sm font-medium text-foreground/70">AI Configuration</span>
              <span className="text-sm text-muted-foreground/40">{questions.length} questions</span>
            </div>
            <button
              type="button"
              onClick={handleSkipQuestions}
              className="text-sm text-muted-foreground/50 hover:text-foreground/70 transition-colors"
            >
              Skip all
            </button>
          </div>
          <N8nQuestionStepper
            questions={questions}
            userAnswers={userAnswers}
            onAnswerUpdated={(questionId, answer) => wizard.answerUpdated(questionId, answer)}
          />
        </div>
      )}

      {/* Loading indicator for questions generation (shown inline, not as a section) */}
      {questionGenerating && !hasQuestions && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/5 border border-violet-500/10">
          <Sparkles className="w-3.5 h-3.5 text-violet-400 animate-pulse" />
          <span className="text-sm text-violet-300/70">Analyzing template for configuration questions...</span>
        </div>
      )}
    </div>
  );
}
