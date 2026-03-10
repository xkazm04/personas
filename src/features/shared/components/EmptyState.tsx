import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
<<<<<<< HEAD
import { Key, Zap, Bot, Play, Radio, Link, ListChecks, type LucideIcon } from 'lucide-react';

// ── Scenario Variants ────────────────────────────────────────────

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

const SCENARIO_CONFIGS: Record<EmptyStateVariant, ScenarioConfig> = {
  'credentials-need-agents': {
    icon: Key,
    title: 'Your agents need credentials to run',
    subtitle: 'Add API keys and service connections so your agents can interact with external tools.',
    iconColor: 'text-emerald-400/80',
    iconContainerClassName: 'bg-emerald-500/10 border-emerald-500/20',
  },
  'triggers-manual-only': {
    icon: Zap,
    title: 'This agent runs manually only',
    subtitle: 'Add a trigger to automate it — schedules, webhooks, or event-driven.',
    iconColor: 'text-amber-400/80',
    iconContainerClassName: 'bg-amber-500/10 border-amber-500/20',
  },
  'dashboard-no-executions': {
    icon: Play,
    title: 'No executions yet',
    subtitle: 'Get started in three steps to see activity here.',
    iconColor: 'text-primary/70',
    iconContainerClassName: 'bg-primary/10 border-primary/20',
    steps: [
      { icon: Bot, label: 'Create an agent', color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
      { icon: Key, label: 'Add a credential', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
      { icon: Play, label: 'Run your agent', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' },
    ],
  },
  'subscriptions-empty': {
    icon: Radio,
    title: 'No event subscriptions yet',
    subtitle: 'Subscribe to events so this agent reacts automatically when things happen.',
    iconColor: 'text-cyan-400/75',
    iconContainerClassName: 'bg-cyan-500/10 border-cyan-500/20',
  },
  'connectors-empty': {
    icon: Link,
    title: 'No tools or connectors configured',
    subtitle: 'Link external services so your agent can take actions and access data.',
    iconColor: 'text-cyan-400/75',
    iconContainerClassName: 'bg-cyan-500/10 border-cyan-500/20',
  },
  'use-cases-empty': {
    icon: ListChecks,
    title: 'No use cases defined yet',
    subtitle: 'Define what this agent should do — import from a workflow or describe it in plain language.',
    iconColor: 'text-violet-400/75',
    iconContainerClassName: 'bg-violet-500/10 border-violet-500/20',
  },
};

// ── Component ────────────────────────────────────────────────────

interface EmptyStateProps {
  icon?: LucideIcon;
  title?: string;
=======
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
  subtitle?: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  iconColor?: string;
  iconContainerClassName?: string;
  className?: string;
  children?: ReactNode;
<<<<<<< HEAD
  /** Select a predefined scenario template. Explicit props override scenario defaults. */
  variant?: EmptyStateVariant;
}

export default function EmptyState({
  icon,
=======
}

export default function EmptyState({
  icon: Icon,
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
  title,
  subtitle,
  description,
  action,
<<<<<<< HEAD
  iconColor,
  iconContainerClassName,
  className,
  children,
  variant,
}: EmptyStateProps) {
  const scenario = variant ? SCENARIO_CONFIGS[variant] : null;

  const Icon = icon ?? scenario?.icon;
  const resolvedTitle = title ?? scenario?.title ?? '';
  const detailText = subtitle ?? description ?? scenario?.subtitle;
  const resolvedIconColor = iconColor ?? scenario?.iconColor ?? 'text-muted-foreground/80';
  const resolvedContainerClass = iconContainerClassName ?? scenario?.iconContainerClassName ?? 'bg-secondary/35 border-primary/15';
  const steps = scenario?.steps;
=======
  iconColor = 'text-muted-foreground/80',
  iconContainerClassName = 'bg-secondary/35 border-primary/15',
  className,
  children,
}: EmptyStateProps) {
  const detailText = subtitle ?? description;
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`py-8 flex flex-col items-center justify-center text-center gap-2.5 ${className ?? ''}`}
    >
<<<<<<< HEAD
      {Icon && (
        <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${resolvedContainerClass}`}>
          <Icon className={`w-4 h-4 ${resolvedIconColor}`} />
        </div>
      )}
      {resolvedTitle && <h3 className="text-sm font-medium text-foreground/90">{resolvedTitle}</h3>}
      {detailText && <p className="text-sm text-muted-foreground/60 max-w-[34ch]">{detailText}</p>}

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
                  <span className="text-xs text-muted-foreground/70">{step.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

=======
      <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${iconContainerClassName}`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <h3 className="text-sm font-medium text-foreground/90">{title}</h3>
      {detailText && <p className="text-sm text-muted-foreground/60 max-w-[34ch]">{detailText}</p>}
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
      {children ? <div className="pt-1">{children}</div> : null}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-1 px-3 py-1.5 text-sm font-medium rounded-xl bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-colors"
        >
          {action.label}
        </button>
      )}
    </motion.div>
  );
}
