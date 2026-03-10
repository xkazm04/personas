<<<<<<< HEAD
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Sliders, Zap, Sparkles, ShieldCheck, Lock, AlertCircle, Brain, Clock, Webhook, MousePointerClick, Radio, Activity } from 'lucide-react';
import { N8nQuestionStepper } from '@/features/templates/sub_n8n/N8nQuestionStepper';
import { useAdoptionWizard } from '../AdoptionWizardContext';
import { validateVariable } from '@/lib/utils/variableSanitizer';
import { ThemedSelect } from '@/features/shared/components/ThemedSelect';
import type { AdoptionRequirement, SuggestedTrigger } from '@/lib/types/designTypes';
=======
import { useState, useMemo, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { Sliders, Zap, Sparkles, Bell, ShieldCheck, Gauge, ChevronRight, Lock, AlertCircle } from 'lucide-react';
import { TriggerConfigPanel } from '../review/TriggerConfigPanel';
import { ConfigureStep } from '@/features/shared/components/ConfigureStep';
import { useAdoptionWizard } from '../AdoptionWizardContext';
import { validateVariable } from '@/lib/utils/variableSanitizer';
import { ThemedSelect } from '@/features/shared/components/ThemedSelect';
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

// ── Shared styles ─────────────────────────────────────────────────────

const inputClass = 'w-full px-2.5 py-1.5 bg-background/50 border border-primary/10 rounded-xl text-sm text-foreground/90 placeholder-muted-foreground/30 focus:outline-none focus:border-violet-500/30 transition-colors';
const labelClass = 'block text-sm font-medium text-foreground/80';
const descClass = 'text-sm text-muted-foreground/50 mt-0.5';
const fieldClass = 'space-y-1';
<<<<<<< HEAD
const cardClass = 'rounded-xl border border-primary/10 bg-secondary/20 p-4';

// ── Trigger type icon map ─────────────────────────────────────────────

const TRIGGER_ICONS: Record<SuggestedTrigger['trigger_type'], typeof Clock> = {
  schedule: Clock,
  webhook: Webhook,
  manual: MousePointerClick,
  polling: Radio,
  event: Activity,
};

// ── Debounced variable input ──────────────────────────────────────────
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
=======

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
  isRequired: boolean;
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
    <div className="rounded-xl border border-primary/10 bg-secondary/20 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 p-3 text-left hover:bg-secondary/30 transition-colors"
      >
        <ChevronRight
          className={`w-3 h-3 text-muted-foreground/40 transition-transform duration-200 ${
            isOpen ? 'rotate-90' : ''
          }`}
        />
        <span className="text-muted-foreground/60">{meta.icon}</span>
        <span className="text-sm font-medium text-foreground/70 flex-1">
          {meta.title}
        </span>

        {/* Completion label */}
        {meta.total > 0 && (
          <span className={`text-sm ${
            allDone
              ? 'text-emerald-400/60'
              : meta.hasMissing
                ? 'text-amber-400/60'
                : 'text-muted-foreground/60'
          }`}>
            {meta.isRequired
              ? `${meta.configured}/${meta.total} required`
              : allDone ? 'Configured' : 'Optional'
            }
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
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
<<<<<<< HEAD
    requireApproval,
    autoApproveSeverity,
    reviewTimeout,
    memoryEnabled,
    memoryScope,
  } = state;

  const hasVariables = adoptionRequirements.length > 0;
  const hasQuestions = questions !== null && questions.length > 0;

  // ── Selected triggers ──

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
=======
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
  // Only show questions section when they've actually loaded
  const hasQuestions = questions !== null && questions.length > 0;
  // Determine if template uses notifications / approval
  const hasNotificationChannels = (designResult?.suggested_notification_channels?.length ?? 0) > 0;

  // ── Compute section completion metadata ──

  const sections = useMemo<SectionMeta[]>(() => {
    const result: SectionMeta[] = [];

    if (hasVariables) {
      const requiredVars = adoptionRequirements.filter((v) => v.required);
      const total = requiredVars.length;
      const configured = requiredVars.filter((v) => {
        const val = variableValues[v.key] ?? v.default_value ?? '';
        if (!val.trim()) return false;
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
        isRequired: true,
      });
    }

    // Only show notifications if the template has notification channels
    if (hasNotificationChannels) {
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
        isRequired: false,
      });
    }

    // Human Review — always relevant as a safety control
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
      isRequired: false,
    });

    // Execution Limits
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
      hasMissing: !!(sandboxPolicy?.budgetEnforced && maxBudgetUsd == null),
      isRequired: !!sandboxPolicy?.budgetEnforced,
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
        isRequired: false,
      });
    }

    if (hasQuestions) {
      const totalQ = questions.length;
      const answeredQ = questions.filter((q: { id: string }) => userAnswers[q.id]?.trim()).length;
      result.push({
        id: 'questions',
        icon: <Sparkles className="w-4 h-4" />,
        title: 'AI Configuration',
        configured: answeredQ,
        total: totalQ,
        hasMissing: totalQ > 0 && answeredQ < totalQ,
        isRequired: false,
      });
    }

    return result;
  }, [
    hasVariables, adoptionRequirements, variableValues,
    hasNotificationChannels, notificationChannels, alertChannel, alertSeverity,
    requireApproval, autoApproveSeverity, reviewTimeout,
    maxConcurrent, timeoutMs, maxBudgetUsd, sandboxPolicy,
    hasTriggers, selectedTriggerIndices, triggerConfigs,
    hasQuestions, questions, userAnswers,
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

  const sectionMap = useMemo(
    () => new Map(sections.map((s) => [s.id, s])),
    [sections],
  );

  return (
    <div className="space-y-2">
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
      {/* Step header */}
      <div className="mb-1">
        <h3 className="text-base font-semibold text-foreground">Configure Persona</h3>
        <p className="text-sm text-muted-foreground/60 mt-0.5">
<<<<<<< HEAD
          Set template variables, triggers, review policy, and memory.
          {hasRequiredMissing && (
=======
          Set template variables, notification preferences, and safety limits.
          {sections.some((s) => s.isRequired && s.hasMissing) && (
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
            <span className="text-amber-400/70 ml-1">Required fields marked below.</span>
          )}
        </p>
      </div>

<<<<<<< HEAD
      {/* Template Variables — simple card */}
      {hasVariables && (
        <div className={cardClass}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-muted-foreground/60"><Sliders className="w-4 h-4" /></span>
            <span className="text-sm font-medium text-foreground/70">Template Configuration</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 3xl:grid-cols-3 gap-3">
=======
      {/* Template Variables */}
      {sectionMap.has('variables') && (
        <AccordionSection
          meta={sectionMap.get('variables')!}
          isOpen={openSections.has('variables')}
          onToggle={() => toggleSection('variables')}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
            {adoptionRequirements.map((variable) => {
              const value = variableValues[variable.key] ?? variable.default_value ?? '';
              const validation = value.trim() ? validateVariable(value, variable) : null;
              const hasError = validation && !validation.valid;
              const isEmpty = variable.required && !value.trim();
              const showError = hasError || isEmpty;

<<<<<<< HEAD
=======
              const inputType =
                variable.type === 'url' ? 'url'
                  : variable.type === 'email' ? 'email'
                    : 'text';

              const placeholder =
                variable.type === 'cron' ? (variable.default_value ?? '0 9 * * 1-5')
                  : variable.type === 'email' ? (variable.default_value ?? 'user@example.com')
                    : variable.type === 'url' ? (variable.default_value ?? 'https://...')
                      : (variable.default_value ?? '');

>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
<<<<<<< HEAD
                    <DebouncedVariableInput
                      variable={variable}
                      value={value}
                      onUpdate={wizard.updateVariable}
                      inputClass={inputClass}
                      showError={showError}
=======
                    <input
                      type={inputType}
                      value={value}
                      onChange={(e) => wizard.updateVariable(variable.key, e.target.value)}
                      placeholder={placeholder}
                      className={`${inputClass} ${showError ? '!border-red-500/30' : ''}`}
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
<<<<<<< HEAD
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
=======
        </AccordionSection>
      )}

      {/* Notification Preferences */}
      {sectionMap.has('notifications') && (
        <AccordionSection
          meta={sectionMap.get('notifications')!}
          isOpen={openSections.has('notifications')}
          onToggle={() => toggleSection('notifications')}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
                      className={`px-2.5 py-1 text-sm font-medium rounded-xl border transition-colors ${
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
              <ThemedSelect
                value={alertSeverity}
                onChange={(e) => wizard.updatePreference('alertSeverity', e.target.value)}
                className="py-1.5 px-2.5"
              >
                <option value="all">All events</option>
                <option value="warning_critical">Warning + Critical</option>
                <option value="critical_only">Critical only</option>
              </ThemedSelect>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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

<<<<<<< HEAD
            {/* Auto-approve severity */}
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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

<<<<<<< HEAD
            {/* Review timeout */}
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
<<<<<<< HEAD
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

            {/* Memory scope — structured categories + custom input (Area #18) */}
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

      {/* AI Questions — single unified question flow (Phase B)
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
=======
        </AccordionSection>
      )}

      {/* Execution Limits */}
      {sectionMap.has('limits') && (
        <AccordionSection
          meta={sectionMap.get('limits')!}
          isOpen={openSections.has('limits')}
          onToggle={() => toggleSection('limits')}
        >
          {sandboxPolicy?.budgetEnforced && maxBudgetUsd == null && (
            <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-amber-500/10 border border-amber-500/15">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              <span className="text-sm text-amber-300/80">Sandbox mode requires a budget cap for safety.</span>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className={fieldClass}>
              <label className={labelClass}>
                Max concurrent
                {sandboxPolicy && (
                  <span className="inline-flex items-center gap-0.5 ml-1.5 text-amber-400/70 text-sm">
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
              <ThemedSelect
                value={String(timeoutMs)}
                onChange={(e) => wizard.updatePreference('timeoutMs', parseInt(e.target.value))}
                className="py-1.5 px-2.5"
              >
                <option value="300000">5 minutes</option>
                <option value="900000">15 minutes</option>
                <option value="1800000">30 minutes</option>
                <option value="3600000">1 hour</option>
                <option value="0">No limit</option>
              </ThemedSelect>
            </div>

            <div className={fieldClass}>
              <label className={labelClass}>
                Budget cap (USD)
                {sandboxPolicy?.budgetEnforced && (
                  <span className="inline-flex items-center gap-0.5 ml-1.5 text-amber-400/70 text-sm">
                    <Lock className="w-2.5 h-2.5" /> Required
                  </span>
                )}
              </label>
              <p className={descClass}>{sandboxPolicy?.budgetEnforced ? 'Required in sandbox mode' : 'Leave empty for no limit'}</p>
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

      {/* AI Questions — only shown when loaded */}
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
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
