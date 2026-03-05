import {
  Activity, AlertTriangle, CheckCircle2, DollarSign,
  GitBranch, Layers, XCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ToolImpactData } from './useToolImpactData';

interface ToolImpactPanelProps {
  impact: ToolImpactData | undefined;
  isAssigned: boolean;
}

function formatCost(usd: number): string {
  if (usd < 0.001) return '<$0.001';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function ToolImpactPanel({ impact, isAssigned }: ToolImpactPanelProps) {
  if (!impact) {
    return (
      <div className="px-3 pb-3 pt-1">
        <p className="text-sm text-muted-foreground/60 italic">No impact data available</p>
      </div>
    );
  }

  const { useCaseRefs, usage, avgCostPerInvocation, totalCost, credentialLinked, credentialRequired, credentialType, coUsedTools } = impact;
  const hasUseCases = useCaseRefs.length > 0;
  const hasUsage = usage && usage.total_invocations > 0;
  const hasCost = totalCost > 0 || avgCostPerInvocation !== null;
  const hasCo = coUsedTools.length > 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="overflow-hidden"
      >
        <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-primary/8 mt-2">

          {/* Use Case References */}
          <ImpactSection
            icon={<Layers className="w-3 h-3" />}
            label="Use Cases"
            badge={hasUseCases ? String(useCaseRefs.length) : undefined}
          >
            {hasUseCases ? (
              <div className="space-y-1">
                {useCaseRefs.slice(0, 4).map((uc) => (
                  <div key={uc.useCaseId} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-foreground/70 truncate">{uc.title}</span>
                    <span className="text-sm text-muted-foreground/60 flex-shrink-0 tabular-nums">
                      {uc.executionCount} run{uc.executionCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                ))}
                {useCaseRefs.length > 4 && (
                  <p className="text-sm text-muted-foreground/50">+{useCaseRefs.length - 4} more</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/50">No use cases have executed this tool yet</p>
            )}
            {isAssigned && hasUseCases && (
              <div className="flex items-center gap-1.5 mt-1 px-1.5 py-0.5 rounded bg-amber-500/8 border border-amber-500/15">
                <AlertTriangle className="w-3 h-3 text-amber-400/70 flex-shrink-0" />
                <span className="text-sm text-amber-400/80">
                  Removing this tool affects {useCaseRefs.length} use case{useCaseRefs.length > 1 ? 's' : ''}
                </span>
              </div>
            )}
          </ImpactSection>

          {/* Usage Stats */}
          <ImpactSection icon={<Activity className="w-3 h-3" />} label="Usage (30d)">
            {hasUsage ? (
              <div className="grid grid-cols-3 gap-2">
                <StatPill label="Calls" value={usage.total_invocations.toLocaleString()} />
                <StatPill label="Runs" value={usage.unique_executions.toLocaleString()} />
                <StatPill label="Agents" value={usage.unique_personas.toLocaleString()} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/50">No usage recorded</p>
            )}
          </ImpactSection>

          {/* Cost Impact */}
          {hasCost && (
            <ImpactSection icon={<DollarSign className="w-3 h-3" />} label="Cost Impact">
              <div className="flex items-center gap-3">
                {avgCostPerInvocation !== null && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-muted-foreground/60">Per call:</span>
                    <span className="text-sm font-mono text-foreground/70">
                      {formatCost(avgCostPerInvocation)}
                    </span>
                  </div>
                )}
                {totalCost > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-muted-foreground/60">Total:</span>
                    <span className="text-sm font-mono text-foreground/70">
                      {formatCost(totalCost)}
                    </span>
                  </div>
                )}
              </div>
            </ImpactSection>
          )}

          {/* Credential Status */}
          {credentialRequired && (
            <ImpactSection icon={credentialLinked
              ? <CheckCircle2 className="w-3 h-3 text-emerald-400/80" />
              : <XCircle className="w-3 h-3 text-red-400/80" />
            } label="Credential">
              <div className="flex items-center gap-1.5">
                <span className={`text-sm ${credentialLinked ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                  {credentialType}
                </span>
                <span className="text-sm text-muted-foreground/50">
                  {credentialLinked ? '— linked' : '— missing'}
                </span>
              </div>
            </ImpactSection>
          )}

          {/* Tool Dependencies */}
          {hasCo && (
            <ImpactSection
              icon={<GitBranch className="w-3 h-3" />}
              label="Often Used With"
            >
              <div className="flex flex-wrap gap-1.5">
                {coUsedTools.map((co) => (
                  <span
                    key={co.toolName}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-sm bg-primary/5 border border-primary/10 text-foreground/60"
                    title={`Co-used ${co.coOccurrences} time${co.coOccurrences !== 1 ? 's' : ''}`}
                  >
                    {co.toolName}
                    <span className="text-muted-foreground/40 tabular-nums">{co.coOccurrences}</span>
                  </span>
                ))}
              </div>
            </ImpactSection>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function ImpactSection({
  icon,
  label,
  badge,
  children,
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
          <span className="ml-auto text-sm font-mono px-1 py-px rounded bg-primary/8 text-muted-foreground/60 border border-primary/10">
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
    <div className="flex flex-col items-center px-2 py-1 rounded-lg bg-background/30 border border-primary/8">
      <span className="text-sm font-mono text-foreground/70 tabular-nums">{value}</span>
      <span className="text-sm text-muted-foreground/50 uppercase tracking-wider">{label}</span>
    </div>
  );
}
