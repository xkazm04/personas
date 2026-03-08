import { useMemo } from 'react';
import { Sliders, Zap, Sparkles, ShieldCheck, Lock, AlertCircle, Brain, Clock, Webhook, MousePointerClick, Radio, MessageCircle, Activity } from 'lucide-react';
import { N8nQuestionStepper } from '@/features/templates/sub_n8n/N8nQuestionStepper';
import { useAdoptionWizard } from '../AdoptionWizardContext';
import { validateVariable } from '@/lib/utils/variableSanitizer';
import { ThemedSelect } from '@/features/shared/components/ThemedSelect';
import type { SuggestedTrigger, AdoptionQuestion } from '@/lib/types/designTypes';

// ── Shared styles ─────────────────────────────────────────────────────

const inputClass = 'w-full px-2.5 py-1.5 bg-background/50 border border-primary/10 rounded-xl text-sm text-foreground/90 placeholder-muted-foreground/30 focus:outline-none focus:border-violet-500/30 transition-colors';
const labelClass = 'block text-sm font-medium text-foreground/80';
const descClass = 'text-sm text-muted-foreground/50 mt-0.5';
const fieldClass = 'space-y-1';
const cardClass = 'rounded-xl border border-primary/10 bg-secondary/20 p-4';

// ── Trigger type icon map ─────────────────────────────────────────────

const TRIGGER_ICONS: Record<SuggestedTrigger['trigger_type'], typeof Clock> = {
  schedule: Clock,
  webhook: Webhook,
  manual: MousePointerClick,
  polling: Radio,
  event: Activity,
};

// ── Component ─────────────────────────────────────────────────────────

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

  // ── Template adoption questions (filtered by selected use cases) ──

  const adoptionQuestions = useMemo<AdoptionQuestion[]>(() => {
    const all = designResult?.adoption_questions;
    if (!all || all.length === 0) return [];
    const selectedIds = state.selectedUseCaseIds;
    return all.filter((q) => {
      // Show if no use_case_ids constraint, or if at least one selected use case matches
      if (!q.use_case_ids || q.use_case_ids.length === 0) return true;
      return q.use_case_ids.some((id) => selectedIds.has(id));
    });
  }, [designResult, state.selectedUseCaseIds]);

  const hasAdoptionQuestions = adoptionQuestions.length > 0;

  // ── Selected triggers ──

  const selectedTriggers = useMemo(() => {
    if (!designResult?.suggested_triggers) return [];
    return designResult.suggested_triggers
      .map((t, i) => ({ trigger: t, originalIndex: i }))
      .filter(({ originalIndex }) => selectedTriggerIndices.has(originalIndex));
  }, [designResult, selectedTriggerIndices]);

  // ── Variable validation summary ──

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

      {/* Template Variables — simple card */}
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
                    <input
                      type={inputType}
                      value={value}
                      onChange={(e) => wizard.updateVariable(variable.key, e.target.value)}
                      placeholder={placeholder}
                      className={`${inputClass} ${showError ? '!border-red-500/30' : ''}`}
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
                            ''
                          }
                          onChange={(e) =>
                            wizard.updateTriggerConfig(originalIndex, {
                              ...currentConfig,
                              schedule: e.target.value,
                            })
                          }
                        />
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
                        Triggered manually — no configuration needed
                      </p>
                    )}

                    {trigger.trigger_type === 'event' && (
                      <p className="text-sm text-muted-foreground/40 italic">
                        Triggered by system events — no configuration needed
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

            {/* Memory scope */}
            <div className={fieldClass}>
              <label className={labelClass}>Memory scope</label>
              <p className={descClass}>Guide what the persona remembers</p>
              <input
                type="text"
                value={memoryScope}
                onChange={(e) => wizard.updatePreference('memoryScope', e.target.value)}
                placeholder="What should the persona remember between runs?"
                className={inputClass}
                disabled={!memoryEnabled}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Template-specific adoption questions */}
      {hasAdoptionQuestions && (
        <div className={cardClass}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-blue-400/70"><MessageCircle className="w-4 h-4" /></span>
            <span className="text-sm font-medium text-foreground/70">Setup Questions</span>
            <span className="text-sm text-muted-foreground/40 ml-auto">{adoptionQuestions.length} questions</span>
          </div>
          <p className={`${descClass} mb-3`}>
            These questions help customize the persona for your specific setup.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 3xl:grid-cols-3 gap-3">
            {adoptionQuestions.map((q) => {
              const answer = userAnswers[q.id] ?? q.default ?? '';
              return (
                <div key={q.id} className={fieldClass}>
                  <label className={labelClass}>{q.question}</label>
                  {q.context && <p className={descClass}>{q.context}</p>}

                  {q.type === 'select' && q.options ? (
                    <ThemedSelect
                      value={answer}
                      onChange={(e) => wizard.answerUpdated(q.id, e.target.value)}
                      className="py-1.5 px-2.5"
                    >
                      <option value="">Select...</option>
                      {q.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </ThemedSelect>
                  ) : q.type === 'boolean' ? (
                    <div className="flex gap-2 mt-1">
                      {(q.options ?? ['Yes', 'No']).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => wizard.answerUpdated(q.id, opt)}
                          className={`px-3 py-1 text-sm font-medium rounded-lg border transition-colors ${
                            answer === opt
                              ? 'bg-violet-500/15 text-violet-300 border-violet-500/25'
                              : 'bg-secondary/30 text-muted-foreground/60 border-primary/10 hover:bg-secondary/50'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={answer}
                      onChange={(e) => wizard.answerUpdated(q.id, e.target.value)}
                      placeholder={q.default ?? ''}
                      className={inputClass}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AI Questions — card stepper (same UX as n8n import) */}
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
