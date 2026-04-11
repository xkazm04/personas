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

/** Estimated duration hints for long-running steps. */
const STEP_DURATION_HINT: Partial<Record<N8nWizardStep, string>> = {
  analyze: '~30s',
};

interface N8nStepIndicatorProps {
  currentStep: N8nWizardStep;
  /** True when the current step is actively processing (analyzing, transforming). */
  processing?: boolean;
  className?: string;
}

export function N8nStepIndicator({ currentStep, processing = false, className = '' }: N8nStepIndicatorProps) {
  const { t } = useTranslation();
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

  const showTimer = processing && !!STEP_DURATION_HINT[currentStep];

  return (
    <nav className={`flex items-center gap-1 px-2 py-3 ${className}`} role="navigation" aria-label="Import wizard progress">
      <div className="flex items-center gap-1 w-full" role="list" aria-label="Wizard steps">
      {VISIBLE_STEPS.map((step, i) => {
        const Icon = STEP_ICONS[step] ?? Hammer;
        const labelKey = STEP_LABEL_KEYS[step];
        const label = labelKey ? t.templates.n8n[labelKey] : step;
        const isCompleted = i < activeIndex;
        const isActive = i === activeIndex;
        const hint = STEP_DURATION_HINT[step];
        const statusText = isCompleted ? 'completed' : isActive ? 'in progress' : 'upcoming';

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
                    className="animate-fade-in absolute w-7 h-7 rounded-full bg-violet-500/20"
                  />
                )}
                <div
                  className={`animate-fade-in w-6 h-6 rounded-full flex items-center justify-center transition-colors duration-300 ${
                    isActive
                      ? 'bg-violet-500/30 border border-violet-400/50'
                      : isCompleted
                        ? 'bg-emerald-500/20 border border-emerald-400/40'
                        : 'bg-secondary/40 border border-primary/10'
                  }`}
                >
                  {isCompleted ? (
                    <Check className="w-3 h-3 text-emerald-400" strokeWidth={3} />
                  ) : (
                    <Icon
                      className={`w-3 h-3 ${
                        isActive ? 'text-violet-300' : 'text-muted-foreground/80'
                      }`}
                    />
                  )}
                </div>
              </div>

              {/* Step label + timer */}
              <div className="min-w-0">
                <span className="sr-only">
                  {`Step ${i + 1} of ${VISIBLE_STEPS.length}: ${label} (${statusText})`}
                </span>
                <span
                  className={`text-sm font-medium truncate transition-colors duration-300 block ${
                    isActive
                      ? 'text-violet-300'
                      : isCompleted
                        ? 'text-emerald-400/70'
                        : 'text-muted-foreground/80'
                  }`}
                >
                  {label}
                </span>
                {isActive && showTimer && (
                  <span className="text-sm font-mono text-muted-foreground/90 tabular-nums leading-none">
                    {Math.floor(elapsed / 60)}:{(elapsed % 60).toString().padStart(2, '0')}
                    <span className="ml-1 text-muted-foreground/60">{hint}</span>
                  </span>
                )}
                {isActive && !showTimer && hint && (
                  <span className="text-sm text-muted-foreground/90 leading-none">{hint}</span>
                )}
              </div>
            </div>

            {/* Connector line */}
            {i < VISIBLE_STEPS.length - 1 && (
              <div className="flex-1 h-px mx-1.5 min-w-4">
                <div
                  className={`h-full rounded-full transition-colors duration-300 ${
                    i < activeIndex ? 'bg-emerald-400/40' : 'bg-secondary/25'
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
