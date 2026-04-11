import {
  Activity, AlertTriangle, CheckCircle2, DollarSign,
  GitBranch, Layers, XCircle,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ToolImpactData } from '../libs/toolImpactTypes';
import { TOOLS_BORDER, TOOLS_INNER_SPACE, TOOLS_SECTION_GAP } from '@/lib/utils/designTokens';

interface ToolImpactPanelProps {
  impact: ToolImpactData | undefined;
  isAssigned: boolean;
}

import { formatCost as _formatCost } from '@/lib/utils/formatters';
const formatCost = (usd: number) => _formatCost(usd, { precision: 'auto' });

export function ToolImpactPanel({ impact, isAssigned }: ToolImpactPanelProps) {
  const { t, tx } = useTranslation();
  if (!impact) {
    return (
      <div className="px-3 pb-3 pt-1">
        <p className="text-sm text-muted-foreground/60 italic">{t.agents.tools.no_impact}</p>
      </div>
    );
  }

  const { useCaseRefs, usage, avgCostPerInvocation, totalCost, credentialLinked, credentialRequired, credentialType, coUsedTools } = impact;
  const hasUseCases = useCaseRefs.length > 0;
  const hasUsage = usage && usage.total_invocations > 0;
  const hasCost = totalCost > 0 || avgCostPerInvocation !== null;
  const hasCo = coUsedTools.length > 0;

  return (
    <div
        className="animate-fade-slide-in overflow-hidden"
      >
        <div className={`px-3 pb-3 pt-1 ${TOOLS_INNER_SPACE} border-t ${TOOLS_BORDER} ${TOOLS_SECTION_GAP}`}>
          <ImpactSection icon={<Layers className="w-3 h-3" />} label={t.agents.tools.uc_section} badge={hasUseCases ? String(useCaseRefs.length) : undefined}>
            {hasUseCases ? (
              <div className="space-y-1">
                {useCaseRefs.slice(0, 4).map((uc) => (
                  <div key={uc.useCaseId} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-foreground/70 truncate">{uc.title}</span>
                    <span className="text-sm text-muted-foreground/60 flex-shrink-0 tabular-nums">
                      {tx(t.agents.tools.runs, { count: uc.executionCount })}
                    </span>
                  </div>
                ))}
                {useCaseRefs.length > 4 && (
                  <p className="text-sm text-muted-foreground/50">{tx(t.agents.tools.more_uc, { count: useCaseRefs.length - 4 })}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/50">{t.agents.tools.no_uc}</p>
            )}
            {isAssigned && hasUseCases && (
              <div className="flex items-center gap-1.5 mt-1 px-1.5 py-0.5 rounded bg-amber-500/8 border border-amber-500/15">
                <AlertTriangle className="w-3 h-3 text-amber-400/70 flex-shrink-0" />
                <span className="text-sm text-amber-400/80">
                  {tx(t.agents.tools.removing_affects, { count: useCaseRefs.length })}
                </span>
              </div>
            )}
          </ImpactSection>
          <ImpactSection icon={<Activity className="w-3 h-3" />} label={t.agents.tools.usage_30d}>
            {hasUsage ? (
              <div className="grid grid-cols-3 gap-2">
                <StatPill label={t.agents.tools.stat_calls} value={usage.total_invocations.toLocaleString()} />
                <StatPill label={t.agents.tools.stat_runs} value={usage.unique_executions.toLocaleString()} />
                <StatPill label={t.agents.tools.stat_agents} value={usage.unique_personas.toLocaleString()} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/50">{t.agents.tools.no_usage}</p>
            )}
          </ImpactSection>
          {hasCost && (
            <ImpactSection icon={<DollarSign className="w-3 h-3" />} label={t.agents.tools.cost_impact}>
              <div className="flex items-center gap-3">
                {avgCostPerInvocation !== null && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-muted-foreground/60">{t.agents.tools.per_call}</span>
                    <span className="text-sm font-mono text-foreground/70">{formatCost(avgCostPerInvocation)}</span>
                  </div>
                )}
                {totalCost > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-muted-foreground/60">{t.agents.tools.total_cost}</span>
                    <span className="text-sm font-mono text-foreground/70">{formatCost(totalCost)}</span>
                  </div>
                )}
              </div>
            </ImpactSection>
          )}
          {credentialRequired && (
            <ImpactSection icon={credentialLinked
              ? <CheckCircle2 className="w-3 h-3 text-emerald-400/80" />
              : <XCircle className="w-3 h-3 text-red-400/80" />
            } label={t.agents.tools.credential}>
              <div className="flex items-center gap-1.5">
                <span className={`text-sm ${credentialLinked ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                  {credentialType}
                </span>
                <span className="text-sm text-muted-foreground/50">
                  {credentialLinked ? t.agents.tools.linked : t.agents.tools.cred_missing}
                </span>
              </div>
            </ImpactSection>
          )}
          {hasCo && (
            <ImpactSection icon={<GitBranch className="w-3 h-3" />} label={t.agents.tools.often_used}>
              <div className="flex flex-wrap gap-1.5">
                {coUsedTools.map((co) => (
                  <span
                    key={co.toolName}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-sm bg-primary/5 border ${TOOLS_BORDER} text-foreground/60`}
                    title={`Co-used ${co.coOccurrences} time${co.coOccurrences !== 1 ? 's' : ''}`}
                  >
                    {co.toolName}
                    <span className="text-muted-foreground/60 tabular-nums">{co.coOccurrences}</span>
                  </span>
                ))}
              </div>
            </ImpactSection>
          )}
        </div>
      </div>
  );
}

function ImpactSection({
  icon, label, badge, children,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground/50">{icon}</span>
        <span className="text-sm font-medium text-muted-foreground/70 uppercase tracking-wider">{label}</span>
        {badge && (
          <span className={`ml-auto text-sm font-mono px-1 py-px rounded bg-primary/8 text-muted-foreground/60 border ${TOOLS_BORDER}`}>
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className={`flex flex-col items-center px-2 py-1 rounded-lg bg-background/30 border ${TOOLS_BORDER}`}>
      <span className="text-sm font-mono text-foreground/70 tabular-nums">{value}</span>
      <span className="text-sm text-muted-foreground/50 uppercase tracking-wider">{label}</span>
    </div>
  );
}
