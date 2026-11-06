import { useState, useEffect, useRef } from 'react';
import { Upload, Search, Check, Hammer } from 'lucide-react';
import { STEP_META, type N8nWizardStep } from '../hooks/useN8nImportReducer';
import { useTranslation } from '@/i18n/useTranslation';

/** Visible steps in the n8n import wizard (upload → analyze → build persona). */
const VISIBLE_STEPS: readonly N8nWizardStep[] = ['upload', 'analyze'] as const;

const STEP_ICONS: Partial<Record<N8nWizardStep, React.ComponentType<{ className?: string }>>> = {
  upload: Upload,
  analyze: Search,
};

const STEP_LABEL_KEYS: Partial<Record<N8nWizardStep, 'upload_step' | 'analyze_step'>> = {
  upload: 'upload_step',
  analyze: 'analyze_step',
};

/** Steps that carry an estimated-duration hint (the text is the catalog's `step_hint_analyze`). */
const STEPS_WITH_DURATION_HINT: ReadonlySet<N8nWizardStep> = new Set<N8nWizardStep>(['analyze']);

interface N8nStepIndicatorProps {
  currentStep: N8nWizardStep;
  /** True when the current step is actively processing (analyzing, transforming). */
  processing?: boolean;
  className?: string;
}

export function N8nStepIndicator({ currentStep, processing = false, className = '' }: N8nStepIndicatorProps) {
  const { t, tx } = useTranslation();
  const activeIndex = STEP_META[currentStep].index;

  // Elapsed timer -- resets on step change or when processing starts/stops
  const [elapsed, setElapsed] = useState(0);
  const prevStepRef = useRef(currentStep);
  useEffect(() => {
    if (currentStep !== prevStepRef.current) {
      setElapsed(0);
      prevStepRef.current = currentStep;
    }
    if (!processing) {
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [processing, currentStep]);

  const showTimer = processing && STEPS_WITH_DURATION_HINT.has(currentStep);

  return (
    <nav className={`flex items-center gap-1 px-2 py-3 ${className}`} role="navigation" aria-label={t.templates.n8n.wizard_progress_aria}>
      <div className="flex items-center gap-1 w-full" role="list" aria-label={t.templates.n8n.wizard_steps_aria}>
      {VISIBLE_STEPS.map((step, i) => {
        const Icon = STEP_ICONS[step] ?? Hammer;
        const labelKey = STEP_LABEL_KEYS[step];
        const label = labelKey ? t.templates.n8n[labelKey] : step;
        const isCompleted = i < activeIndex;
        const isActive = i === activeIndex;
        const hint = STEPS_WITH_DURATION_HINT.has(step) ? t.templates.n8n.step_hint_analyze : undefined;
        const statusText = isCompleted ? t.templates.n8n.step_status_completed : isActive ? t.templates.n8n.step_status_in_progress : t.templates.n8n.step_status_upcoming;

        return (
          <div
            key={step}
            className="flex items-center gap-1 flex-1 last:flex-initial"
            role="listitem"
            aria-current={isActive ? 'step' : undefined}
          >
            <div className="flex items-center gap-2 min-w-0">
              {/* Step circle */}
              <div className="relative flex items-center justify-center">
                {isActive && (
                  <div
                    className="animate-fade-in absolute w-7 h-7 rounded-full bg-role-agent/20"
                  />
                )}
                <div
                  className={`animate-fade-in w-6 h-6 rounded-full flex items-center justify-center transition-colors duration-300 ${
                    isActive
                      ? 'bg-role-agent/30 border border-role-agent/50'
                      : isCompleted
                        ? 'bg-status-success/20 border border-status-success/40'
                        : 'bg-surface-2 border border-hair'
                  }`}
                >
                  {isCompleted ? (
                    <Check className="w-3 h-3 text-status-success" strokeWidth={3} />
                  ) : (
                    <Icon
                      className={`w-3 h-3 ${
                        isActive ? 'text-role-agent' : 'text-foreground'
                      }`}
                    />
                  )}
                </div>
              </div>

              {/* Step label + timer */}
              <div className="min-w-0">
                <span className="sr-only">
                  {tx(t.templates.n8n.step_sr_label, { current: i + 1, total: VISIBLE_STEPS.length, label, status: statusText })}
                </span>
                <span
                  className={`typo-body truncate transition-colors duration-300 block ${
                    isActive
                      ? 'text-role-agent'
                      : isCompleted
                        ? 'text-status-success/70'
                        : 'text-foreground'
                  }`}
                >
                  {label}
                </span>
                {isActive && showTimer && (
                  <span className="typo-code text-foreground tabular-nums">
                    {Math.floor(elapsed / 60)}:{(elapsed % 60).toString().padStart(2, '0')}
                    <span className="ml-1 text-foreground">{hint}</span>
                  </span>
                )}
                {isActive && !showTimer && hint && (
                  <span className="typo-body text-foreground">{hint}</span>
                )}
              </div>
            </div>

            {/* Connector line */}
            {i < VISIBLE_STEPS.length - 1 && (
              <div className="flex-1 h-px mx-1.5 min-w-4">
                <div
                  className={`h-full rounded-full transition-colors duration-300 ${
                    i < activeIndex ? 'bg-status-success/40' : 'bg-surface-1'
                  }`}
                />
              </div>
            )}
          </div>
        );
      })}
      </div>
    </nav>
  );
}
