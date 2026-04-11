import { useState, useMemo } from 'react';
import {
  AlertTriangle, Play, SkipForward, Clock,
  CheckCircle2, ChevronDown,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { CronAgent } from '@/lib/bindings/CronAgent';
import type { SkippedExecution, RecoveryPolicy } from '../libs/scheduleHelpers';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { formatRelative, formatInterval } from '../libs/scheduleHelpers';
import { useTranslation } from '@/i18n/useTranslation';

interface SkippedRecoveryPanelProps {
  skipped: SkippedExecution[];
  recoveringId: string | null;
  onBatchRecover: (agents: CronAgent[]) => void;
  onManualExecute: (agent: CronAgent) => void;
}

export default function SkippedRecoveryPanel({
  skipped,
  recoveringId,
  onBatchRecover,
  onManualExecute,
}: SkippedRecoveryPanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [policies, setPolicies] = useState<Record<string, RecoveryPolicy>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visibleSkipped = useMemo(
    () => skipped.filter((s) => !dismissed.has(s.agent.trigger_id)),
    [skipped, dismissed],
  );

  if (visibleSkipped.length === 0) return null;

  const getPolicy = (triggerId: string): RecoveryPolicy =>
    policies[triggerId] || 'ask';

  const setPolicy = (triggerId: string, policy: RecoveryPolicy) =>
    setPolicies((p) => ({ ...p, [triggerId]: policy }));

  const recoverableAgents = visibleSkipped
    .filter((s) => getPolicy(s.agent.trigger_id) === 'recover')
    .map((s) => s.agent);

  const handleDismiss = (triggerId: string) => {
    setDismissed((d) => new Set([...d, triggerId]));
  };

  const handleDismissAll = () => {
    setDismissed(new Set(skipped.map((s) => s.agent.trigger_id)));
  };

  const totalMissed = visibleSkipped.reduce((sum, s) => sum + s.missedCount, 0);

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-amber-500/[0.06] transition-colors"
      >
        <div className="relative w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          {visibleSkipped.length > 1 && (
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="absolute inset-0 rounded-full animate-ping bg-amber-400/40" />
              <span className="relative w-2.5 h-2.5 rounded-full bg-amber-400 border border-amber-600/30" />
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="typo-heading text-amber-400/90">
            {visibleSkipped.length} agent{visibleSkipped.length !== 1 ? 's' : ''} missed executions
          </p>
          <p className="text-xs text-muted-foreground/60">
            ~{totalMissed} total runs skipped while app was offline
          </p>
        </div>
        <ChevronDown className={`w-4 h-4 text-amber-400/60 transition-transform ${expanded ? 'rotate-0' : '-rotate-90'}`} />
      </button>

      {expanded && (
        <div className="border-t border-amber-500/15">
          {/* Recovery rows */}
          <div className="divide-y divide-amber-500/10">
            {visibleSkipped.map(({ agent, missedAt, missedCount }) => {
              const policy = getPolicy(agent.trigger_id);
              const isRecovering = recoveringId === agent.trigger_id;

              return (
                <div key={agent.trigger_id} className="flex items-center gap-3 px-4 py-3">
                  {/* Agent info */}
                  <PersonaIcon icon={agent.persona_icon} color={agent.persona_color} display="pop" frameSize={"lg"}
                    frameStyle={{
                      backgroundColor: agent.persona_color ? `${agent.persona_color}15` : 'var(--color-primary-5)',
                      color: agent.persona_color || 'var(--color-muted-foreground)',
                    }} />

                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-foreground/80 truncate block">
                      {agent.persona_name}
                    </span>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 mt-0.5">
                      <Clock className="w-3 h-3" />
                      <span>{missedCount} missed since {formatRelative(missedAt.toISOString())}</span>
                      {agent.interval_seconds && (
                        <>
                          <span className="text-muted-foreground/30">·</span>
                          <span className="font-mono">every {formatInterval(agent.interval_seconds)}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Policy selector */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        if (policy === 'recover') {
                          setPolicy(agent.trigger_id, 'ask');
                        } else {
                          setPolicy(agent.trigger_id, 'recover');
                        }
                      }}
                      disabled={isRecovering}
                      className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border transition-colors ${policy === 'recover'
                          ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400'
                          : 'bg-secondary/30 border-primary/10 text-muted-foreground/60 hover:text-emerald-400 hover:bg-emerald-500/10'
                        }`}
                      title="Mark for recovery"
                    >
                      {isRecovering ? (
                        <LoadingSpinner size="xs" />
                      ) : policy === 'recover' ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : (
                        <Play className="w-3 h-3" />
                      )}
                      Recover
                    </button>

                    <button
                      onClick={() => onManualExecute(agent)}
                      disabled={isRecovering}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border bg-secondary/30 border-primary/10 text-muted-foreground/60 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                      title="Run once now"
                    >
                      <Play className="w-3 h-3" />
                      Run 1x
                    </button>

                    <button
                      onClick={() => handleDismiss(agent.trigger_id)}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border bg-secondary/30 border-primary/10 text-muted-foreground/60 hover:text-muted-foreground/90 transition-colors"
                      title="Skip -- don't recover"
                    >
                      <SkipForward className="w-3 h-3" />
                      Skip
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Batch actions */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-amber-500/15 bg-amber-500/[0.03]">
            <button
              onClick={handleDismissAll}
              className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
            >
              {t.schedules.dismiss_all}
            </button>

            <div className="flex items-center gap-2">
              {recoverableAgents.length > 0 && (
                <button
                  onClick={() => onBatchRecover(recoverableAgents)}
                  disabled={!!recoveringId}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-emerald-500/30 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
                >
                  {recoveringId ? (
                    <LoadingSpinner size="xs" />
                  ) : (
                    <Play className="w-3 h-3" />
                  )}
                  Recover {recoverableAgents.length} selected
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
