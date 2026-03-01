import { useState, useMemo, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { Sliders, Zap, Sparkles, Bell, ShieldCheck, Gauge, ChevronRight, Lock, AlertCircle } from 'lucide-react';
import { TriggerConfigPanel } from '../review/TriggerConfigPanel';
import { ConfigureStep } from '@/features/shared/components/ConfigureStep';
import { useAdoptionWizard } from '../AdoptionWizardContext';
import { validateVariable } from '@/lib/utils/variableSanitizer';

// ── Shared styles ─────────────────────────────────────────────────────

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

// ── Section completion metadata ───────────────────────────────────────

interface SectionMeta {
  id: string;
  icon: ReactNode;
  title: string;
  configured: number;
  total: number;
  hasMissing: boolean;
}

// ── Accordion panel ───────────────────────────────────────────────────

function AccordionSection({
  meta,
  isOpen,
  onToggle,
  children,
}: {
  meta: SectionMeta;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(isOpen ? undefined : 0);

  useEffect(() => {
    if (!contentRef.current) return;
    if (isOpen) {
      setHeight(contentRef.current.scrollHeight);
      const timer = setTimeout(() => setHeight(undefined), 200);
      return () => clearTimeout(timer);
    } else {
      setHeight(contentRef.current.scrollHeight);
      requestAnimationFrame(() => setHeight(0));
    }
  }, [isOpen]);

  const allDone = meta.configured === meta.total && meta.total > 0;

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 overflow-hidden transition-colors">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 p-3.5 text-left hover:bg-secondary/30 transition-colors group"
      >
        <ChevronRight
          className={`w-3.5 h-3.5 text-muted-foreground/40 transition-transform duration-200 ${
            isOpen ? 'rotate-90' : ''
          }`}
        />
        <span className="text-muted-foreground/60">{meta.icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 flex-1">
          {meta.title}
        </span>

        {/* Completion indicator */}
        {meta.total > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="flex gap-0.5">
              {Array.from({ length: meta.total }, (_, i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i < meta.configured
                      ? allDone
                        ? 'bg-emerald-400/80'
                        : 'bg-violet-400/70'
                      : meta.hasMissing
                        ? 'bg-red-400/30'
                        : 'bg-muted-foreground/15'
                  }`}
                />
              ))}
            </span>
            <span className={`text-[10px] tabular-nums ${
              allDone
                ? 'text-emerald-400/60'
                : meta.hasMissing
                  ? 'text-red-400/50'
                  : 'text-muted-foreground/30'
            }`}>
              {meta.configured}/{meta.total}
            </span>
          </span>
        )}
      </button>

      <div
        ref={contentRef}
        style={{ maxHeight: height === undefined ? 'none' : `${height}px` }}
        className="transition-[max-height] duration-200 ease-in-out overflow-hidden"
      >
        <div className="px-4 pb-4">
          {children}
        </div>
      </div>
    </div>
  );
}

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

  // ── Compute section completion metadata ──

  const sections = useMemo<SectionMeta[]>(() => {
    const result: SectionMeta[] = [];

    if (hasVariables) {
      const total = adoptionRequirements.filter((v) => v.required).length;
      const configured = adoptionRequirements.filter((v) => {
        if (!v.required) return false;
        const val = variableValues[v.key] ?? v.default_value ?? '';
        if (!val.trim()) return false;
        // Also check type validation — invalid values don't count as configured
        const check = validateVariable(val, v);
        return check.valid;
      }).length;
      result.push({
        id: 'variables',
        icon: <Sliders className="w-4 h-4" />,
        title: 'Template Configuration',
        configured,
        total,
        hasMissing: configured < total,
      });
    }

    // Notifications: 3 fields, count non-default ones
    const notifConfigured = [
      notificationChannels.length > 0,
      alertChannel.trim().length > 0,
      alertSeverity !== 'all',
    ].filter(Boolean).length;
    result.push({
      id: 'notifications',
      icon: <Bell className="w-4 h-4" />,
      title: 'Notifications',
      configured: notifConfigured,
      total: 3,
      hasMissing: false,
    });

    // Human Review: 3 fields, all optional with defaults
    const reviewConfigured = [
      requireApproval,
      autoApproveSeverity !== 'info',
      reviewTimeout !== '1h',
    ].filter(Boolean).length;
    result.push({
      id: 'review',
      icon: <ShieldCheck className="w-4 h-4" />,
      title: 'Human Review',
      configured: reviewConfigured,
      total: 3,
      hasMissing: false,
    });

    // Execution Limits: 3 fields, all optional with defaults
    const limitsConfigured = [
      maxConcurrent !== 1,
      timeoutMs !== 300000,
      maxBudgetUsd != null,
    ].filter(Boolean).length;
    result.push({
      id: 'limits',
      icon: <Gauge className="w-4 h-4" />,
      title: 'Execution Limits',
      configured: limitsConfigured,
      total: 3,
      hasMissing: false,
    });

    if (hasTriggers) {
      const selectedCount = selectedTriggerIndices.size;
      const configuredCount = Object.keys(triggerConfigs).length;
      result.push({
        id: 'triggers',
        icon: <Zap className="w-4 h-4" />,
        title: 'Trigger Setup',
        configured: Math.min(configuredCount, selectedCount),
        total: selectedCount,
        hasMissing: false,
      });
    }

    if (hasQuestions) {
      const totalQ = questions?.length ?? 0;
      const answeredQ = questions
        ? questions.filter((q: { id: string }) => userAnswers[q.id]?.trim()).length
        : 0;
      result.push({
        id: 'questions',
        icon: <Sparkles className="w-4 h-4" />,
        title: 'AI Configuration',
        configured: answeredQ,
        total: totalQ,
        hasMissing: questionGenerating || (totalQ > 0 && answeredQ < totalQ),
      });
    }

    return result;
  }, [
    hasVariables, adoptionRequirements, variableValues,
    notificationChannels, alertChannel, alertSeverity,
    requireApproval, autoApproveSeverity, reviewTimeout,
    maxConcurrent, timeoutMs, maxBudgetUsd,
    hasTriggers, selectedTriggerIndices, triggerConfigs,
    hasQuestions, questions, userAnswers, questionGenerating,
  ]);

  // ── Accordion state: auto-expand first section with missing required fields ──

  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    const firstMissing = sections.find((s) => s.hasMissing);
    if (firstMissing) {
      initial.add(firstMissing.id);
    } else if (sections[0]) {
      initial.add(sections[0].id);
    }
    return initial;
  });

  const toggleSection = useCallback((id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function toggleNotificationChannel(channel: string) {
    const current = [...notificationChannels];
    const idx = current.indexOf(channel);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(channel);
    wizard.updatePreference('notificationChannels', current);
  }

  // Map section ID → meta for quick lookup
  const sectionMap = useMemo(
    () => new Map(sections.map((s) => [s.id, s])),
    [sections],
  );

  return (
    <div className="space-y-2">
      {/* Template Variables */}
      {sectionMap.has('variables') && (
        <AccordionSection
          meta={sectionMap.get('variables')!}
          isOpen={openSections.has('variables')}
          onToggle={() => toggleSection('variables')}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                      <span className="ml-1.5 text-[10px] text-muted-foreground/40 font-normal">{variable.type}</span>
                    )}
                  </label>
                  {variable.description && <p className={descClass}>{variable.description}</p>}

                  {variable.type === 'select' && variable.options ? (
                    <select
                      value={value}
                      onChange={(e) => wizard.updateVariable(variable.key, e.target.value)}
                      className={`${selectClass} ${showError ? '!border-red-500/30' : ''}`}
                    >
                      <option value="">Select...</option>
                      {variable.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
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
                    <p className="flex items-center gap-1 text-[11px] text-red-400/80 mt-0.5">
                      <AlertCircle className="w-3 h-3 flex-shrink-0" />
                      {validation.error}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </AccordionSection>
      )}

      {/* Notification Preferences */}
      {sectionMap.has('notifications') && (
        <AccordionSection
          meta={sectionMap.get('notifications')!}
          isOpen={openSections.has('notifications')}
          onToggle={() => toggleSection('notifications')}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
        </AccordionSection>
      )}

      {/* Human Review */}
      {sectionMap.has('review') && (
        <AccordionSection
          meta={sectionMap.get('review')!}
          isOpen={openSections.has('review')}
          onToggle={() => toggleSection('review')}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className={fieldClass}>
              <label className={labelClass}>
                Require approval
                {sandboxPolicy?.requireApproval && (
                  <span className="inline-flex items-center gap-0.5 ml-1.5 text-amber-400/70 text-[10px]">
                    <Lock className="w-2.5 h-2.5" /> Sandbox
                  </span>
                )}
              </label>
              <p className={descClass}>Pause before executing actions</p>
              <button
                type="button"
                onClick={() => {
                  if (sandboxPolicy?.requireApproval) return;
                  wizard.updatePreference('requireApproval', !requireApproval);
                }}
                disabled={sandboxPolicy?.requireApproval}
                className={`mt-1 w-11 h-6 rounded-full border transition-colors flex items-center ${
                  requireApproval || sandboxPolicy?.requireApproval
                    ? 'bg-violet-500/30 border-violet-500/40 justify-end'
                    : 'bg-secondary/40 border-primary/15 justify-start'
                } ${sandboxPolicy?.requireApproval ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <div className={`w-4.5 h-4.5 rounded-full mx-0.5 transition-colors ${
                  requireApproval || sandboxPolicy?.requireApproval ? 'bg-violet-400' : 'bg-muted-foreground/30'
                }`} />
              </button>
            </div>

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
        </AccordionSection>
      )}

      {/* Execution Limits */}
      {sectionMap.has('limits') && (
        <AccordionSection
          meta={sectionMap.get('limits')!}
          isOpen={openSections.has('limits')}
          onToggle={() => toggleSection('limits')}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className={fieldClass}>
              <label className={labelClass}>
                Max concurrent
                {sandboxPolicy && (
                  <span className="inline-flex items-center gap-0.5 ml-1.5 text-amber-400/70 text-[10px]">
                    <Lock className="w-2.5 h-2.5" /> Max {sandboxPolicy.maxConcurrent}
                  </span>
                )}
              </label>
              <p className={descClass}>Parallel run limit</p>
              <input
                type="number"
                min={1}
                max={sandboxPolicy ? sandboxPolicy.maxConcurrent : 10}
                value={Math.min(maxConcurrent, sandboxPolicy?.maxConcurrent ?? 10)}
                onChange={(e) => {
                  const cap = sandboxPolicy?.maxConcurrent ?? 10;
                  wizard.updatePreference('maxConcurrent', Math.min(cap, Math.max(1, parseInt(e.target.value) || 1)));
                }}
                className={inputClass}
              />
            </div>

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

            <div className={fieldClass}>
              <label className={labelClass}>
                Budget cap (USD)
                {sandboxPolicy?.budgetEnforced && (
                  <span className="inline-flex items-center gap-0.5 ml-1.5 text-amber-400/70 text-[10px]">
                    <Lock className="w-2.5 h-2.5" /> Required
                  </span>
                )}
              </label>
              <p className={descClass}>{sandboxPolicy?.budgetEnforced ? 'Budget cap required in sandbox mode' : 'Leave empty for no limit'}</p>
              <input
                type="number"
                min={sandboxPolicy?.budgetEnforced ? 0.5 : 0}
                step={0.5}
                value={maxBudgetUsd ?? (sandboxPolicy?.budgetEnforced ? 5 : '')}
                onChange={(e) => {
                  const val = e.target.value;
                  if (sandboxPolicy?.budgetEnforced && (val === '' || parseFloat(val) <= 0)) {
                    wizard.updatePreference('maxBudgetUsd', 0.5);
                  } else {
                    wizard.updatePreference('maxBudgetUsd', val === '' ? null : parseFloat(val));
                  }
                }}
                placeholder={sandboxPolicy?.budgetEnforced ? '$5.00' : 'No limit'}
                className={inputClass}
              />
            </div>
          </div>
        </AccordionSection>
      )}

      {/* Trigger Configuration */}
      {sectionMap.has('triggers') && designResult?.suggested_triggers && (
        <AccordionSection
          meta={sectionMap.get('triggers')!}
          isOpen={openSections.has('triggers')}
          onToggle={() => toggleSection('triggers')}
        >
          <TriggerConfigPanel
            triggers={designResult.suggested_triggers}
            selectedIndices={selectedTriggerIndices}
            configs={triggerConfigs}
            onConfigChange={wizard.updateTriggerConfig}
          />
        </AccordionSection>
      )}

      {/* AI Questions */}
      {sectionMap.has('questions') && (
        <AccordionSection
          meta={sectionMap.get('questions')!}
          isOpen={openSections.has('questions')}
          onToggle={() => toggleSection('questions')}
        >
          <ConfigureStep
            questions={questions}
            userAnswers={userAnswers}
            questionGenerating={questionGenerating}
            onAnswerUpdated={(questionId, answer) => wizard.answerUpdated(questionId, answer)}
            onSkip={handleSkipQuestions}
          />
        </AccordionSection>
      )}
    </div>
  );
}
