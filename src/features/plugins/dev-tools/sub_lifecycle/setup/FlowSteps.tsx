import {
  CheckCircle2, XCircle, AlertCircle, Bot, Target,
  ClipboardCheck, Brain, Play, Clock, RefreshCw, Zap,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';

type TxFn = (template: string, vars: Record<string, string | number>) => string;

type StepColor = 'violet' | 'blue' | 'amber' | 'emerald' | 'red';

// Static class bundles so Tailwind's JIT can detect every class at build time.
// `bg-${color}-500/15` style template strings are invisible to the JIT and
// silently produce no styles, so the icon tiles stayed unstyled.
const STEP_COLOR_CLASSES: Record<StepColor, { tile: string; icon: string }> = {
  violet:  { tile: 'bg-violet-500/15 border-violet-500/25',   icon: 'text-violet-400'  },
  blue:    { tile: 'bg-blue-500/15 border-blue-500/25',       icon: 'text-blue-400'    },
  amber:   { tile: 'bg-amber-500/15 border-amber-500/25',     icon: 'text-amber-400'   },
  emerald: { tile: 'bg-emerald-500/15 border-emerald-500/25', icon: 'text-emerald-400' },
  red:     { tile: 'bg-red-500/15 border-red-500/25',         icon: 'text-red-400'     },
};

export interface FlowStep {
  id: string;
  label: string;
  description: string;
  icon: typeof Bot;
  color: StepColor;
  status: 'idle' | 'configured' | 'active' | 'error';
}

export function buildFlowSteps(
  devClone: { name: string } | null,
  hasScheduleTrigger: boolean,
  hasApprovedListener: boolean,
  hasRejectedListener: boolean,
  goalCount: number,
  t: Translations,
  tx: TxFn,
): FlowStep[] {
  const dl = t.plugins.dev_lifecycle;
  return [
    { id: 'persona', label: dl.flow_persona_label, description: devClone ? tx(dl.flow_persona_ready, { name: devClone.name }) : dl.flow_persona_idle, icon: Bot, color: 'violet', status: devClone ? 'configured' : 'idle' },
    { id: 'schedule', label: dl.flow_schedule_label, description: hasScheduleTrigger ? dl.flow_schedule_active : dl.flow_schedule_idle, icon: Clock, color: 'blue', status: hasScheduleTrigger ? 'active' : 'idle' },
    { id: 'goals', label: dl.flow_goals_label, description: tx(dl.flow_goals_count, { count: goalCount }), icon: Target, color: 'amber', status: goalCount > 0 ? 'configured' : 'idle' },
    { id: 'review', label: dl.flow_review_label, description: dl.flow_review_desc, icon: ClipboardCheck, color: 'emerald', status: 'configured' },
    { id: 'approved', label: dl.flow_approved_label, description: hasApprovedListener ? dl.flow_approved_active : dl.flow_approved_idle, icon: Play, color: 'emerald', status: hasApprovedListener ? 'active' : 'idle' },
    { id: 'rejected', label: dl.flow_rejected_label, description: hasRejectedListener ? dl.flow_rejected_active : dl.flow_rejected_idle, icon: RefreshCw, color: 'red', status: hasRejectedListener ? 'active' : 'idle' },
    { id: 'memory', label: dl.flow_memory_label, description: dl.flow_memory_desc, icon: Brain, color: 'violet', status: 'configured' },
  ];
}

export function FlowStepsList({ steps }: { steps: FlowStep[] }) {
  return (
    <div className="rounded-card border border-primary/15 overflow-hidden divide-y divide-primary/10">
      {steps.map((step) => {
        const Icon = step.icon;
        const statusIcon = step.status === 'active'
          ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          : step.status === 'configured'
          ? <CheckCircle2 className="w-4 h-4 text-blue-400" />
          : step.status === 'error'
          ? <XCircle className="w-4 h-4 text-red-400" />
          : <AlertCircle className="w-4 h-4 text-foreground" />;
        return (
          <div key={step.id} className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
            step.status === 'active' ? 'bg-emerald-500/5'
            : step.status === 'configured' ? 'bg-primary/5'
            : 'bg-card/20 opacity-75'
          }`}>
            <div className={`w-8 h-8 rounded-interactive border ${STEP_COLOR_CLASSES[step.color].tile} flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-4 h-4 ${STEP_COLOR_CLASSES[step.color].icon}`} />
            </div>
            <span className="typo-card-label shrink-0">{step.label}</span>
            <span className="typo-body text-foreground shrink-0">·</span>
            <span className="typo-body text-foreground truncate flex-1 min-w-0">{step.description}</span>
            {statusIcon}
          </div>
        );
      })}
    </div>
  );
}

export function TriggerList({ triggers }: { triggers: PersonaTrigger[] }) {
  const { t } = useTranslation();
  if (triggers.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="typo-caption text-primary uppercase tracking-wider">
        {t.plugins.dev_lifecycle.active_triggers}({triggers.length})
      </h3>
      <div className="border border-primary/15 rounded-card overflow-hidden">
        {triggers.map((trigger) => {
          let configLabel = trigger.trigger_type;
          try {
            const cfg = JSON.parse(trigger.config ?? '{}');
            if (cfg.listen_event_type) configLabel = cfg.listen_event_type;
            else if (cfg.cron) configLabel = `cron: ${cfg.cron}`;
          } catch { /* use default */ }
          return (
            <div key={trigger.id} className="flex items-center gap-3 px-4 py-3 border-b border-primary/5 last:border-b-0">
              <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              <span className="typo-body text-foreground flex-1">{trigger.trigger_type}</span>
              <span className="typo-code text-foreground">{configLabel}</span>
              <span className={`rounded-full px-2 py-0.5 typo-caption font-medium border ${
                trigger.enabled ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                : 'bg-red-500/15 text-red-400 border-red-500/25'
              }`}>
                {trigger.enabled ? t.plugins.dev_lifecycle.flow_trigger_enabled : t.plugins.dev_lifecycle.flow_trigger_disabled}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
