import { motion, useReducedMotion } from 'framer-motion';
import { Check, CircleDashed, OctagonX } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * `flow_steps` — a causal / sequence chain. Athena uses it to explain
 * "what happened, then what, and what happens if you act": each step is
 * a node on a vertical rail with a connector that draws in as the steps
 * stagger into view (entry-only animation; reduced motion renders
 * static).
 *
 * Config:
 *   {
 *     "steps": [
 *       {
 *         "label": "Trigger fired",          // required
 *         "detail": "Sentry webhook…",       // optional second line
 *         "status": "done"                   // "done" | "current" | "pending" | "blocked"
 *       }
 *     ]
 *   }
 */
interface FlowStep {
  label: string;
  detail?: string;
  status?: 'done' | 'current' | 'pending' | 'blocked';
}

const NODE: Record<NonNullable<FlowStep['status']>, { ring: string; icon: 'check' | 'dot' | 'dashed' | 'x' }> = {
  done: { ring: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-400', icon: 'check' },
  current: { ring: 'border-primary/60 bg-primary/15 text-primary', icon: 'dot' },
  pending: { ring: 'border-foreground/20 bg-foreground/[0.04] text-foreground', icon: 'dashed' },
  blocked: { ring: 'border-rose-400/50 bg-rose-500/10 text-rose-400', icon: 'x' },
};

export function FlowStepsWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const steps = (config?.steps as FlowStep[] | undefined) ?? [];

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col min-h-0">
      <div className="typo-caption text-foreground uppercase tracking-wide mb-3">
        {title ?? t.overview.cockpit.flow_title}
      </div>
      {steps.length === 0 ? (
        <div className="flex-1 flex items-center justify-center typo-caption">
          {t.overview.cockpit.widget_empty}
        </div>
      ) : (
        <ol className="flex-1 overflow-y-auto">
          {steps.map((step, i) => {
            const node = NODE[step.status ?? 'pending'];
            const last = i === steps.length - 1;
            return (
              <motion.li
                key={`${i}-${step.label}`}
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut', delay: reduceMotion ? 0 : i * 0.12 }}
                className="relative flex gap-3"
              >
                {/* Node + connector rail */}
                <div className="flex flex-col items-center">
                  <span
                    className={`inline-flex items-center justify-center w-6 h-6 rounded-full border shrink-0 ${node.ring}`}
                    aria-hidden
                  >
                    {node.icon === 'check' ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : node.icon === 'x' ? (
                      <OctagonX className="w-3.5 h-3.5" />
                    ) : node.icon === 'dashed' ? (
                      <CircleDashed className="w-3.5 h-3.5" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-current" />
                    )}
                  </span>
                  {!last && (
                    <motion.span
                      initial={reduceMotion ? false : { scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ duration: 0.3, ease: 'easeOut', delay: reduceMotion ? 0 : i * 0.12 + 0.15 }}
                      className="w-px flex-1 min-h-3 bg-foreground/15 origin-top"
                      aria-hidden
                    />
                  )}
                </div>
                <div className={`min-w-0 flex-1 ${last ? '' : 'pb-3'}`}>
                  <div className="typo-body font-medium text-foreground leading-snug">
                    {step.label}
                  </div>
                  {step.detail && (
                    <div className="typo-caption leading-relaxed mt-0.5">{step.detail}</div>
                  )}
                </div>
              </motion.li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
