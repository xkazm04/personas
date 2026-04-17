import {
  Bot,
  Workflow,
  TrendingDown,
  ArrowRightLeft,
  CheckCircle2,
  XCircle,
  HelpCircle,
  AlertTriangle,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { SimulationResult } from './credentialGraph';

const GRADE_ICON: Record<string, typeof CheckCircle2> = {
  healthy: CheckCircle2,
  degraded: AlertTriangle,
  critical: XCircle,
  unknown: HelpCircle,
};

const GRADE_COLOR: Record<string, string> = {
  healthy: 'text-emerald-400',
  degraded: 'text-amber-400',
  critical: 'text-red-400',
  unknown: 'text-foreground',
};

interface AffectedPersonasProps {
  personas: SimulationResult['affectedPersonas'];
}

export function AffectedPersonas({ personas }: AffectedPersonasProps) {
  const { t, tx } = useTranslation();
  const dep = t.vault.dependencies;
  if (personas.length === 0) return null;

  return (
    <div>
      <div className="text-xs font-medium text-foreground mb-1.5 flex items-center gap-1.5">
        <Bot className="w-3 h-3" />
        {tx(dep.personas_would_stop, { count: personas.length })}
      </div>
      <div className="space-y-1 max-h-[140px] overflow-y-auto">
        {personas.map((persona) => {
          const GradeIcon = GRADE_ICON[persona.grade] ?? HelpCircle;
          const gradeColor = GRADE_COLOR[persona.grade] ?? GRADE_COLOR.unknown;
          return (
            <div
              key={persona.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-card bg-secondary/30 border border-primary/8"
            >
              <GradeIcon className={`w-3 h-3 flex-shrink-0 ${gradeColor}`} />
              <span className="text-xs text-foreground flex-1 truncate">{persona.name}</span>
              {persona.via && (
                <span className="text-[10px] text-foreground font-mono">{persona.via}</span>
              )}
              <span className="text-[10px] text-foreground">
                {Math.round(persona.recentExecutions / 7)}/day
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface AffectedWorkflowsProps {
  workflows: SimulationResult['affectedWorkflows'];
}

export function AffectedWorkflows({ workflows }: AffectedWorkflowsProps) {
  const { t, tx } = useTranslation();
  const dep = t.vault.dependencies;
  if (workflows.length === 0) return null;

  return (
    <div>
      <div className="text-xs font-medium text-foreground mb-1.5 flex items-center gap-1.5">
        <Workflow className="w-3 h-3" />
        {tx(dep.workflows_would_break, { count: workflows.length })}
      </div>
      <div className="space-y-1 max-h-[100px] overflow-y-auto">
        {workflows.map((wf) => (
          <div
            key={wf.workflowId}
            className="flex items-center gap-2 px-2 py-1.5 rounded-card bg-red-500/5 border border-red-500/10"
          >
            <TrendingDown className="w-3 h-3 text-red-400/60 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-xs text-foreground block truncate">{wf.workflowName}</span>
              <span className="text-[10px] text-foreground">
                {tx(dep.nodes_broken, { broken: wf.brokenNodeLabels.length, total: wf.totalNodes })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface FailoverSuggestionsProps {
  suggestions: SimulationResult['failoverSuggestions'];
}

export function FailoverSuggestions({ suggestions }: FailoverSuggestionsProps) {
  const { t, tx } = useTranslation();
  const dep = t.vault.dependencies;
  if (suggestions.length === 0) return null;

  return (
    <div>
      <div className="text-xs font-medium text-foreground mb-1.5 flex items-center gap-1.5">
        <ArrowRightLeft className="w-3 h-3" />
        {tx(dep.failover_credentials, { count: suggestions.length })}
      </div>
      <div className="space-y-1">
        {suggestions.map((fo) => (
          <div
            key={fo.credentialId}
            className="flex items-center gap-2 px-2 py-1.5 rounded-card bg-emerald-500/5 border border-emerald-500/10"
          >
            {fo.healthOk === true ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
            ) : fo.healthOk === false ? (
              <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
            ) : (
              <HelpCircle className="w-3 h-3 text-foreground flex-shrink-0" />
            )}
            <span className="text-xs text-foreground flex-1 truncate">{fo.credentialName}</span>
            <span className="text-[10px] text-foreground font-mono">{fo.serviceType}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface MitigationSummaryProps {
  simulation: SimulationResult;
}

export function MitigationSummary({ simulation }: MitigationSummaryProps) {
  const { t, tx } = useTranslation();
  const dep = t.vault.dependencies;
  if (simulation.severity === 'low') return null;

  return (
    <div className="rounded-card bg-primary/5 border border-primary/10 p-2">
      <div className="text-[10px] font-medium text-foreground mb-1">{dep.suggested_mitigations}</div>
      <ul className="text-xs text-foreground space-y-0.5 list-disc list-inside">
        {simulation.failoverSuggestions.some((f) => f.healthOk === true) && (
          <li>{dep.mitigation_failover}</li>
        )}
        {simulation.affectedWorkflows.length > 0 && (
          <li>{dep.mitigation_pause}</li>
        )}
        {simulation.estimatedDailyExecutionsLost > 10 && (
          <li>{dep.mitigation_schedule}</li>
        )}
        {simulation.failoverSuggestions.length === 0 && (
          <li>{tx(dep.mitigation_create, { serviceType: simulation.serviceType })}</li>
        )}
      </ul>
    </div>
  );
}
