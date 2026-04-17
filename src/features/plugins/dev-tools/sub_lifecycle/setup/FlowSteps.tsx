import {
  CheckCircle2, XCircle, AlertCircle, Bot, Target,
  ClipboardCheck, Brain, Play, Clock, RefreshCw, Zap,
} from 'lucide-react';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';

export interface FlowStep {
  id: string;
  label: string;
  description: string;
  icon: typeof Bot;
  color: string;
  status: 'idle' | 'configured' | 'active' | 'error';
}

export function buildFlowSteps(
  devClone: { name: string } | null,
  hasScheduleTrigger: boolean,
  hasApprovedListener: boolean,
  hasRejectedListener: boolean,
  goalCount: number,
): FlowStep[] {
  return [
    { id: 'persona', label: 'Dev Clone Persona', description: devClone ? `"${devClone.name}" ready` : 'Adopt from bundled template', icon: Bot, color: 'violet', status: devClone ? 'configured' : 'idle' },
    { id: 'schedule', label: 'Hourly Scan', description: hasScheduleTrigger ? 'Cron trigger active (0 * * * *)' : 'Periodic codebase analysis', icon: Clock, color: 'blue', status: hasScheduleTrigger ? 'active' : 'idle' },
    { id: 'goals', label: 'Goals', description: `${goalCount} goal(s) in project`, icon: Target, color: 'amber', status: goalCount > 0 ? 'configured' : 'idle' },
    { id: 'review', label: 'Human Review', description: 'Tasks proposed for approval', icon: ClipboardCheck, color: 'emerald', status: 'configured' },
    { id: 'approved', label: 'Approval → Build', description: hasApprovedListener ? 'Event listener active' : 'Triggers Dev Clone build cycle', icon: Play, color: 'emerald', status: hasApprovedListener ? 'active' : 'idle' },
    { id: 'rejected', label: 'Rejection → Recompose', description: hasRejectedListener ? 'Event listener active' : 'Triggers recomposition with feedback', icon: RefreshCw, color: 'red', status: hasRejectedListener ? 'active' : 'idle' },
    { id: 'memory', label: 'Memory Learning', description: 'Decisions auto-saved as learned memories', icon: Brain, color: 'violet', status: 'configured' },
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
            <div className={`w-8 h-8 rounded-interactive bg-${step.color}-500/15 border border-${step.color}-500/25 flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-4 h-4 text-${step.color}-400`} />
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
  if (triggers.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="typo-caption text-primary uppercase tracking-wider">
        Active Triggers ({triggers.length})
      </h3>
      <div className="border border-primary/15 rounded-card overflow-hidden">
        {triggers.map((t) => {
          let configLabel = t.trigger_type;
          try {
            const cfg = JSON.parse(t.config ?? '{}');
            if (cfg.listen_event_type) configLabel = cfg.listen_event_type;
            else if (cfg.cron) configLabel = `cron: ${cfg.cron}`;
          } catch { /* use default */ }
          return (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3 border-b border-primary/5 last:border-b-0">
              <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              <span className="typo-body text-foreground flex-1">{t.trigger_type}</span>
              <span className="typo-code text-foreground">{configLabel}</span>
              <span className={`rounded-full px-2 py-0.5 typo-caption font-medium border ${
                t.enabled ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                : 'bg-red-500/15 text-red-400 border-red-500/25'
              }`}>
                {t.enabled ? 'enabled' : 'disabled'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
