import { Sliders, Zap, Sparkles, Bell, ShieldCheck, Gauge } from 'lucide-react';
import { TriggerConfigPanel } from '../review/TriggerConfigPanel';
import { ConfigureStep } from '@/features/shared/components/ConfigureStep';
import { useAdoptionWizard } from '../AdoptionWizardContext';

// ── Shared styles ─────────────────────────────────────────────────────

const sectionClass = 'rounded-xl border border-primary/10 bg-secondary/20 p-4';
const sectionHeaderClass = 'flex items-center gap-2 mb-3';
const sectionTitleClass = 'text-xs font-semibold uppercase tracking-wider text-muted-foreground/60';
const selectClass = 'w-full px-2.5 py-1.5 bg-background/50 border border-primary/10 rounded-lg text-sm text-foreground/90 focus:outline-none focus:border-violet-500/30 transition-colors';
const inputClass = 'w-full px-2.5 py-1.5 bg-background/50 border border-primary/10 rounded-lg text-sm text-foreground/90 placeholder-muted-foreground/30 focus:outline-none focus:border-violet-500/30 transition-colors';
const labelClass = 'block text-sm font-medium text-foreground/80';
const descClass = 'text-xs text-muted-foreground/50 mt-0.5';
const fieldClass = 'space-y-1';

// ── Notification channel options ──────────────────────────────────────

const CHANNEL_OPTIONS = [
  { value: 'slack', label: 'Slack' },
  { value: 'email', label: 'Email' },
  { value: 'telegram', label: 'Telegram' },
] as const;

// ── Component ─────────────────────────────────────────────────────────

export function TuneStep() {
  const {
    state,
    wizard,
    designResult,
    adoptionRequirements,
    handleSkipQuestions,
  } = useAdoptionWizard();

  const {
    variableValues,
    selectedTriggerIndices,
    triggerConfigs,
    questions,
    userAnswers,
    questionGenerating,
    notificationChannels,
    alertChannel,
    alertSeverity,
    requireApproval,
    autoApproveSeverity,
    reviewTimeout,
    maxConcurrent,
    timeoutMs,
    maxBudgetUsd,
  } = state;

  const hasVariables = adoptionRequirements.length > 0;
  const hasTriggers = selectedTriggerIndices.size > 0 && (designResult?.suggested_triggers?.length ?? 0) > 0;
  const hasQuestions = questions !== null || questionGenerating;

  function toggleNotificationChannel(channel: string) {
    const current = [...notificationChannels];
    const idx = current.indexOf(channel);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(channel);
    wizard.updatePreference('notificationChannels', current);
  }

  return (
    <div className="space-y-4">
      {/* Template Variables */}
      {hasVariables && (
        <div className={sectionClass}>
          <div className={sectionHeaderClass}>
            <Sliders className="w-4 h-4 text-muted-foreground/60" />
            <span className={sectionTitleClass}>Template Configuration</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {adoptionRequirements.map((variable) => {
              const value = variableValues[variable.key] ?? variable.default_value ?? '';
              const isEmpty = variable.required && !value.trim();

              return (
                <div key={variable.key} className={fieldClass}>
                  <label className={labelClass}>
                    {variable.label}
                    {variable.required && <span className="text-red-400 ml-0.5">*</span>}
                  </label>
                  {variable.description && <p className={descClass}>{variable.description}</p>}

                  {variable.type === 'select' && variable.options ? (
                    <select
                      value={value}
                      onChange={(e) => wizard.updateVariable(variable.key, e.target.value)}
                      className={`${selectClass} ${isEmpty ? '!border-red-500/30' : ''}`}
                    >
                      <option value="">Select...</option>
                      {variable.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={variable.type === 'url' ? 'url' : 'text'}
                      value={value}
                      onChange={(e) => wizard.updateVariable(variable.key, e.target.value)}
                      placeholder={variable.default_value ?? ''}
                      className={`${inputClass} ${isEmpty ? '!border-red-500/30' : ''}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Notification Preferences */}
      <div className={sectionClass}>
        <div className={sectionHeaderClass}>
          <Bell className="w-4 h-4 text-muted-foreground/60" />
          <span className={sectionTitleClass}>Notifications</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Channel chips */}
          <div className={fieldClass}>
            <label className={labelClass}>Notify via</label>
            <div className="flex gap-1.5 flex-wrap mt-1">
              {CHANNEL_OPTIONS.map(({ value, label }) => {
                const active = notificationChannels.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleNotificationChannel(value)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${
                      active
                        ? 'bg-violet-500/15 text-violet-300 border-violet-500/25'
                        : 'bg-secondary/30 text-muted-foreground/60 border-primary/10 hover:bg-secondary/50'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Alert channel */}
          <div className={fieldClass}>
            <label className={labelClass}>Alert target</label>
            <p className={descClass}>Channel or email</p>
            <input
              type="text"
              value={alertChannel}
              onChange={(e) => wizard.updatePreference('alertChannel', e.target.value)}
              placeholder="#alerts or oncall@..."
              className={inputClass}
            />
          </div>

          {/* Severity threshold */}
          <div className={fieldClass}>
            <label className={labelClass}>Severity threshold</label>
            <p className={descClass}>Minimum severity to alert</p>
            <select
              value={alertSeverity}
              onChange={(e) => wizard.updatePreference('alertSeverity', e.target.value)}
              className={selectClass}
            >
              <option value="all">All events</option>
              <option value="warning_critical">Warning + Critical</option>
              <option value="critical_only">Critical only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Human Review */}
      <div className={sectionClass}>
        <div className={sectionHeaderClass}>
          <ShieldCheck className="w-4 h-4 text-muted-foreground/60" />
          <span className={sectionTitleClass}>Human Review</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Approval toggle */}
          <div className={fieldClass}>
            <label className={labelClass}>Require approval</label>
            <p className={descClass}>Pause before executing actions</p>
            <button
              type="button"
              onClick={() => wizard.updatePreference('requireApproval', !requireApproval)}
              className={`mt-1 w-11 h-6 rounded-full border transition-colors flex items-center ${
                requireApproval
                  ? 'bg-violet-500/30 border-violet-500/40 justify-end'
                  : 'bg-secondary/40 border-primary/15 justify-start'
              }`}
            >
              <div className={`w-4.5 h-4.5 rounded-full mx-0.5 transition-colors ${
                requireApproval ? 'bg-violet-400' : 'bg-muted-foreground/30'
              }`} />
            </button>
          </div>

          {/* Auto-approve */}
          <div className={fieldClass}>
            <label className={labelClass}>Auto-approve</label>
            <p className={descClass}>Skip review for lower severity</p>
            <select
              value={autoApproveSeverity}
              onChange={(e) => wizard.updatePreference('autoApproveSeverity', e.target.value)}
              className={selectClass}
            >
              <option value="info">Info only</option>
              <option value="info_warning">Info + Warning</option>
              <option value="all">All (no review)</option>
            </select>
          </div>

          {/* Timeout */}
          <div className={fieldClass}>
            <label className={labelClass}>Review timeout</label>
            <p className={descClass}>Auto-reject after timeout</p>
            <select
              value={reviewTimeout}
              onChange={(e) => wizard.updatePreference('reviewTimeout', e.target.value)}
              className={selectClass}
            >
              <option value="1h">1 hour</option>
              <option value="4h">4 hours</option>
              <option value="24h">24 hours</option>
              <option value="none">No timeout</option>
            </select>
          </div>
        </div>
      </div>

      {/* Execution Limits */}
      <div className={sectionClass}>
        <div className={sectionHeaderClass}>
          <Gauge className="w-4 h-4 text-muted-foreground/60" />
          <span className={sectionTitleClass}>Execution Limits</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Max concurrent */}
          <div className={fieldClass}>
            <label className={labelClass}>Max concurrent</label>
            <p className={descClass}>Parallel run limit</p>
            <input
              type="number"
              min={1}
              max={10}
              value={maxConcurrent}
              onChange={(e) => wizard.updatePreference('maxConcurrent', Math.max(1, parseInt(e.target.value) || 1))}
              className={inputClass}
            />
          </div>

          {/* Timeout */}
          <div className={fieldClass}>
            <label className={labelClass}>Timeout per run</label>
            <p className={descClass}>Max execution time</p>
            <select
              value={String(timeoutMs)}
              onChange={(e) => wizard.updatePreference('timeoutMs', parseInt(e.target.value))}
              className={selectClass}
            >
              <option value="300000">5 minutes</option>
              <option value="900000">15 minutes</option>
              <option value="1800000">30 minutes</option>
              <option value="3600000">1 hour</option>
              <option value="0">No limit</option>
            </select>
          </div>

          {/* Budget */}
          <div className={fieldClass}>
            <label className={labelClass}>Budget cap (USD)</label>
            <p className={descClass}>Leave empty for no limit</p>
            <input
              type="number"
              min={0}
              step={0.5}
              value={maxBudgetUsd ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                wizard.updatePreference('maxBudgetUsd', val === '' ? null : parseFloat(val));
              }}
              placeholder="No limit"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Trigger Configuration */}
      {hasTriggers && designResult?.suggested_triggers && (
        <div className={sectionClass}>
          <div className={sectionHeaderClass}>
            <Zap className="w-4 h-4 text-muted-foreground/60" />
            <span className={sectionTitleClass}>Trigger Setup</span>
          </div>

          <TriggerConfigPanel
            triggers={designResult.suggested_triggers}
            selectedIndices={selectedTriggerIndices}
            configs={triggerConfigs}
            onConfigChange={wizard.updateTriggerConfig}
          />
        </div>
      )}

      {/* AI Questions */}
      {hasQuestions && (
        <div className={sectionClass}>
          <div className={sectionHeaderClass}>
            <Sparkles className="w-4 h-4 text-muted-foreground/60" />
            <span className={sectionTitleClass}>AI Configuration</span>
          </div>

          <ConfigureStep
            questions={questions}
            userAnswers={userAnswers}
            questionGenerating={questionGenerating}
            onAnswerUpdated={(questionId, answer) => wizard.answerUpdated(questionId, answer)}
            onSkip={handleSkipQuestions}
          />
        </div>
      )}
    </div>
  );
}
