import type { ReactNode } from 'react';
import { Key, Zap, Bot, Play, Radio, Link, ListChecks, type LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

// -- Scenario Variants --------------------------------------------

export type EmptyStateVariant =
  | 'credentials-need-agents'
  | 'triggers-manual-only'
  | 'dashboard-no-executions'
  | 'subscriptions-empty'
  | 'connectors-empty'
  | 'use-cases-empty';

interface StepGuide {
  icon: LucideIcon;
  label: string;
  color: string;
}

interface ScenarioConfig {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  iconColor: string;
  iconContainerClassName: string;
  steps?: StepGuide[];
}

/** Style config per scenario (icons + colors only -- text comes from translations). */
const SCENARIO_STYLES: Record<EmptyStateVariant, Omit<ScenarioConfig, 'title' | 'subtitle' | 'steps'> & { hasSteps?: boolean }> = {
  'credentials-need-agents': { icon: Key, iconColor: 'text-emerald-400/80', iconContainerClassName: 'bg-emerald-500/10 border-emerald-500/20' },
  'triggers-manual-only': { icon: Zap, iconColor: 'text-amber-400/80', iconContainerClassName: 'bg-amber-500/10 border-amber-500/20' },
  'dashboard-no-executions': { icon: Play, iconColor: 'text-primary/70', iconContainerClassName: 'bg-primary/10 border-primary/20', hasSteps: true },
  'subscriptions-empty': { icon: Radio, iconColor: 'text-cyan-400/75', iconContainerClassName: 'bg-cyan-500/10 border-cyan-500/20' },
  'connectors-empty': { icon: Link, iconColor: 'text-cyan-400/75', iconContainerClassName: 'bg-cyan-500/10 border-cyan-500/20' },
  'use-cases-empty': { icon: ListChecks, iconColor: 'text-violet-400/75', iconContainerClassName: 'bg-violet-500/10 border-violet-500/20' },
};

function useScenarioConfigs(): Record<EmptyStateVariant, ScenarioConfig> {
  const { t } = useTranslation();
  const es = t.empty_states;
  return {
    'credentials-need-agents': { ...SCENARIO_STYLES['credentials-need-agents'], title: es.credentials_title, subtitle: es.credentials_subtitle },
    'triggers-manual-only': { ...SCENARIO_STYLES['triggers-manual-only'], title: es.triggers_title, subtitle: es.triggers_subtitle },
    'dashboard-no-executions': {
      ...SCENARIO_STYLES['dashboard-no-executions'],
      title: es.executions_title,
      subtitle: es.executions_subtitle,
      steps: [
        { icon: Bot, label: es.step_create, color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
        { icon: Key, label: es.step_credential, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
        { icon: Play, label: es.step_run, color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' },
      ],
    },
    'subscriptions-empty': { ...SCENARIO_STYLES['subscriptions-empty'], title: es.events_title, subtitle: es.events_subtitle },
    'connectors-empty': { ...SCENARIO_STYLES['connectors-empty'], title: es.tools_title, subtitle: es.tools_subtitle },
    'use-cases-empty': { ...SCENARIO_STYLES['use-cases-empty'], title: es.use_cases_title, subtitle: es.use_cases_subtitle },
  };
}

// -- Component ----------------------------------------------------

interface EmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
}

interface EmptyStateProps {
  icon?: LucideIcon;
  title?: string;
  subtitle?: string;
  description?: string;
  action?: EmptyStateAction;
  /** Second CTA rendered as a ghost button alongside the primary action. */
  secondaryAction?: EmptyStateAction;
  iconColor?: string;
  iconContainerClassName?: string;
  className?: string;
  children?: ReactNode;
  /** Select a predefined scenario template. Explicit props override scenario defaults. */
  variant?: EmptyStateVariant;
}

export default function EmptyState({
  icon,
  title,
  subtitle,
  description,
  action,
  secondaryAction,
  iconColor,
  iconContainerClassName,
  className,
  children,
  variant,
}: EmptyStateProps) {
  const scenarioConfigs = useScenarioConfigs();
  const scenario = variant ? scenarioConfigs[variant] : null;

  const Icon = icon ?? scenario?.icon;
  const resolvedTitle = title ?? scenario?.title ?? '';
  const detailText = subtitle ?? description ?? scenario?.subtitle;
  const resolvedIconColor = iconColor ?? scenario?.iconColor ?? 'text-foreground';
  const resolvedContainerClass = iconContainerClassName ?? scenario?.iconContainerClassName ?? 'bg-secondary/35 border-primary/15';
  const steps = scenario?.steps;

  return (
    <div
      className={`animate-fade-slide-in py-8 flex flex-col items-center justify-center text-center gap-3 ${className ?? ''}`}
    >
      {Icon && (
        <div className={`w-14 h-14 rounded-xl border flex items-center justify-center ${resolvedContainerClass}`}>
          <Icon className={`w-6 h-6 ${resolvedIconColor}`} />
        </div>
      )}
      {resolvedTitle && <h3 className="typo-heading-lg text-foreground/90">{resolvedTitle}</h3>}
      {detailText && <p className="typo-body-lg text-foreground max-w-[40ch]">{detailText}</p>}

      {/* Step guide for multi-step scenarios */}
      {steps && (
        <div className="flex items-center gap-3 mt-2">
          {steps.map((step, i) => {
            const StepIcon = step.icon;
            return (
              <div key={i} className="flex items-center gap-2">
                {i > 0 && <div className="w-4 h-px bg-muted-foreground/20" />}
                <div className="flex items-center gap-1.5">
                  <div className={`w-6 h-6 rounded-lg border flex items-center justify-center ${step.color}`}>
                    <StepIcon className="w-3 h-3" />
                  </div>
                  <span className="typo-body text-foreground">{step.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {children ? <div className="pt-1">{children}</div> : null}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-3 mt-1">
          {action && (
            <button
              onClick={action.onClick}
              className="inline-flex items-center gap-1.5 px-4 py-2 typo-heading rounded-xl bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-colors"
            >
              {action.icon && <action.icon className="w-3.5 h-3.5" />}
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className="inline-flex items-center gap-1.5 px-4 py-2 typo-heading rounded-xl text-foreground hover:text-foreground hover:bg-primary/8 border border-primary/10 transition-colors"
            >
              {secondaryAction.icon && <secondaryAction.icon className="w-3.5 h-3.5" />}
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
