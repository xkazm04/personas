import {
  FlaskConical,
  X,
  Bot,
  Workflow,
  TrendingDown,
  ArrowRightLeft,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from 'lucide-react';
import type { SimulationResult } from './credentialGraph';
import { SEVERITY_STYLES } from './graphConstants';

interface SimulationPanelProps {
  simulation: SimulationResult;
  onClose: () => void;
}

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
  unknown: 'text-muted-foreground/50',
};

export function SimulationPanel({ simulation, onClose }: SimulationPanelProps) {
  const sev = SEVERITY_STYLES[simulation.severity];

  return (
    <div
      className="animate-fade-slide-in rounded-xl border border-primary/15 bg-secondary/30 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-fuchsia-400/80" />
          <span className="text-sm font-medium text-foreground/85">Revocation Simulation</span>
          <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-md border ${sev.bg} ${sev.text} ${sev.border}`}>
            {sev.label}
          </span>
        </div>
        <button type="button" onClick={onClose} className="p-1 hover:bg-secondary/50 rounded transition-colors cursor-pointer">
          <X className="w-3.5 h-3.5 text-muted-foreground/50" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Impact Summary Cards */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-secondary/40 border border-primary/8 p-2 text-center">
            <div className="text-lg font-semibold text-foreground/90">{simulation.totalAffectedPersonas}</div>
            <div className="text-[10px] text-muted-foreground/60">Personas Affected</div>
          </div>
          <div className="rounded-lg bg-secondary/40 border border-primary/8 p-2 text-center">
            <div className="text-lg font-semibold text-foreground/90">{simulation.totalAffectedWorkflows}</div>
            <div className="text-[10px] text-muted-foreground/60">Workflows Broken</div>
          </div>
          <div className="rounded-lg bg-secondary/40 border border-primary/8 p-2 text-center">
            <div className="text-lg font-semibold text-foreground/90">{simulation.estimatedDailyExecutionsLost}</div>
            <div className="text-[10px] text-muted-foreground/60">Daily Execs Lost</div>
          </div>
          <div className="rounded-lg bg-secondary/40 border border-primary/8 p-2 text-center">
            <div className="text-lg font-semibold text-foreground/90">
              ${simulation.estimatedDailyRevenueLost.toFixed(2)}
            </div>
            <div className="text-[10px] text-muted-foreground/60">Daily Cost Impact</div>
          </div>
        </div>

        {/* Scenario description */}
        <div className="text-xs text-muted-foreground/70 leading-relaxed px-1">
          {simulation.severity === 'critical' ? (
            <span>
              Revoking <strong className="text-fuchsia-400">{simulation.credentialName}</strong> would break{' '}
              <strong className="text-red-400">{simulation.totalAffectedWorkflows} workflow{simulation.totalAffectedWorkflows !== 1 ? 's' : ''}</strong>{' '}
              and halt {simulation.totalAffectedPersonas} persona{simulation.totalAffectedPersonas !== 1 ? 's' : ''}.
            </span>
          ) : simulation.severity === 'high' ? (
            <span>
              Revoking <strong className="text-red-400">{simulation.credentialName}</strong> would impact{' '}
              {simulation.totalAffectedPersonas} persona{simulation.totalAffectedPersonas !== 1 ? 's' : ''} across your workspace.
            </span>
          ) : simulation.severity === 'medium' ? (
            <span>
              Revoking <strong className="text-amber-400">{simulation.credentialName}</strong> has limited blast radius.
            </span>
          ) : (
            <span>No personas or workflows depend on this credential. Safe to revoke.</span>
          )}
        </div>

        {/* Affected Personas */}
        {simulation.affectedPersonas.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground/60 mb-1.5 flex items-center gap-1.5">
              <Bot className="w-3 h-3" />
              Personas That Would Stop ({simulation.affectedPersonas.length})
            </div>
            <div className="space-y-1 max-h-[140px] overflow-y-auto">
              {simulation.affectedPersonas.map((persona) => {
                const GradeIcon = GRADE_ICON[persona.grade] ?? HelpCircle;
                const gradeColor = GRADE_COLOR[persona.grade] ?? GRADE_COLOR.unknown;
                return (
                  <div
                    key={persona.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-secondary/30 border border-primary/8"
                  >
                    <GradeIcon className={`w-3 h-3 flex-shrink-0 ${gradeColor}`} />
                    <span className="text-xs text-foreground/80 flex-1 truncate">{persona.name}</span>
                    {persona.via && (
                      <span className="text-[10px] text-muted-foreground/50 font-mono">{persona.via}</span>
                    )}
                    <span className="text-[10px] text-muted-foreground/50">
                      {Math.round(persona.recentExecutions / 7)}/day
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Affected Workflows */}
        {simulation.affectedWorkflows.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground/60 mb-1.5 flex items-center gap-1.5">
              <Workflow className="w-3 h-3" />
              Workflows That Would Break ({simulation.affectedWorkflows.length})
            </div>
            <div className="space-y-1 max-h-[100px] overflow-y-auto">
              {simulation.affectedWorkflows.map((wf) => (
                <div
                  key={wf.workflowId}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-red-500/5 border border-red-500/10"
                >
                  <TrendingDown className="w-3 h-3 text-red-400/60 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-foreground/80 block truncate">{wf.workflowName}</span>
                    <span className="text-[10px] text-muted-foreground/50">
                      {wf.brokenNodeLabels.length}/{wf.totalNodes} nodes broken
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Failover Suggestions */}
        {simulation.failoverSuggestions.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground/60 mb-1.5 flex items-center gap-1.5">
              <ArrowRightLeft className="w-3 h-3" />
              Failover Credentials ({simulation.failoverSuggestions.length})
            </div>
            <div className="space-y-1">
              {simulation.failoverSuggestions.map((fo) => (
                <div
                  key={fo.credentialId}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10"
                >
                  {fo.healthOk === true ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                  ) : fo.healthOk === false ? (
                    <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                  ) : (
                    <HelpCircle className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
                  )}
                  <span className="text-xs text-foreground/80 flex-1 truncate">{fo.credentialName}</span>
                  <span className="text-[10px] text-muted-foreground/50 font-mono">{fo.serviceType}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mitigation Summary */}
        {simulation.severity !== 'low' && (
          <div className="rounded-lg bg-primary/5 border border-primary/10 p-2">
            <div className="text-[10px] font-medium text-muted-foreground/60 mb-1">Suggested Mitigations</div>
            <ul className="text-xs text-muted-foreground/70 space-y-0.5 list-disc list-inside">
              {simulation.failoverSuggestions.some((f) => f.healthOk === true) && (
                <li>Switch affected personas to a healthy failover credential</li>
              )}
              {simulation.affectedWorkflows.length > 0 && (
                <li>Pause affected workflows before revoking</li>
              )}
              {simulation.estimatedDailyExecutionsLost > 10 && (
                <li>Schedule revocation during low-traffic hours</li>
              )}
              {simulation.failoverSuggestions.length === 0 && (
                <li>Create a replacement credential for <strong>{simulation.serviceType}</strong> before revoking</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
