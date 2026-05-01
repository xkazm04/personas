import { useState, useEffect } from 'react';
import {
  Stethoscope,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Shield,
  Wrench,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { PersonaExecution } from '@/lib/types/types';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import { listHealingIssues } from '@/api/overview/healing';
import { getRetryChain } from '@/api/overview/healing';
import { createLogger } from '@/lib/log';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';

const logger = createLogger('healing-overlay');

interface HealingOverlayProps {
  execution: PersonaExecution;
  /** Current scrub position (used for revealing animations). */
  currentMs: number;
  totalMs: number;
}

/**
 * Overlay for failed executions showing AI healing diagnosis,
 * healing issues created, and the retry chain diff.
 */
export function HealingOverlay({ execution, currentMs, totalMs }: HealingOverlayProps) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const [issues, setIssues] = useState<PersonaHealingIssue[]>([]);
  const [retryChain, setRetryChain] = useState<PersonaExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null);

  const isFailed = execution.status === 'failed';
  const isIncomplete = execution.status === 'incomplete';

  useEffect(() => {
    if (!isFailed && !isIncomplete) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all([
      listHealingIssues(execution.persona_id).catch((err) => {
        logger.warn('Failed to load healing issues', { error: err });
        return [] as PersonaHealingIssue[];
      }),
      execution.retry_of_execution_id || execution.retry_count > 0
        ? getRetryChain(execution.id, execution.persona_id).catch((err) => {
            logger.warn('Failed to load retry chain', { error: err });
            return [] as PersonaExecution[];
          })
        : Promise.resolve([] as PersonaExecution[]),
    ]).then(([allIssues, chain]) => {
      if (cancelled) return;
      // Filter to issues related to this execution
      const relevant = allIssues.filter(
        (i) => i.execution_id === execution.id || i.execution_id === execution.retry_of_execution_id,
      );
      setIssues(relevant);
      setRetryChain(chain);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [execution.id, execution.persona_id, execution.retry_of_execution_id, execution.retry_count, isFailed, isIncomplete]);

  if (!isFailed && !isIncomplete) return null;

  // Reveal healing diagnosis progressively -- show at the failure point (end of execution)
  const failurePoint = totalMs > 0 ? totalMs * 0.95 : 0;
  const showDiagnosis = currentMs >= failurePoint;

  return (
    <>
      {showDiagnosis && (
        <div
          className="animate-fade-slide-in rounded-modal border border-status-error/25 bg-status-error/5 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-status-error/15">
            <Stethoscope className="w-4 h-4 text-status-error" />
            <span className="typo-heading text-status-error/90">
              {e.ai_healing_diagnosis}
            </span>
            {execution.retry_count > 0 && (
              <span className="ml-auto flex items-center gap-1 typo-code text-brand-cyan/80">
                <RefreshCw className="w-3 h-3" />
                {tx(e.retry_count, { count: execution.retry_count })}
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-6 text-foreground">
              <LoadingSpinner className="mr-2" />
              <span className="typo-body">{e.loading_healing_data}</span>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {/* Error message */}
              {execution.error_message && (
                <div className="rounded-card border border-status-error/20 bg-status-error/[0.08] p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <AlertTriangle className="w-3 h-3 text-status-error" />
                    <span className="text-[10px] font-mono text-status-error/70 uppercase tracking-wider">
                      {e.failure_point}
                    </span>
                  </div>
                  <pre className="typo-code text-status-error/80 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                    {execution.error_message}
                  </pre>
                </div>
              )}

              {/* Healing issues */}
              {issues.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] font-mono text-foreground uppercase tracking-wider">
                    {tx(e.healing_issues_count, { count: issues.length })}
                  </div>
                  {issues.map((issue) => {
                    const isExpanded = expandedIssue === issue.id;
                    return (
                      <div
                        key={issue.id}
                        className={`rounded-card border transition-all ${
                          issue.auto_fixed
                            ? 'border-status-success/20 bg-status-success/5'
                            : issue.is_circuit_breaker
                              ? 'border-status-warning/20 bg-status-warning/5'
                              : 'border-primary/10 bg-secondary/20'
                        }`}
                      >
                        <button
                          onClick={() => setExpandedIssue(isExpanded ? null : issue.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3 h-3 text-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="w-3 h-3 text-foreground shrink-0" />
                          )}
                          <SeverityBadge severity={issue.severity} />
                          <span className="typo-body text-foreground truncate">
                            {issue.title}
                          </span>
                          {issue.auto_fixed && (
                            <span className="ml-auto flex items-center gap-1 text-[10px] font-mono text-status-success shrink-0">
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              {e.auto_fixed}
                            </span>
                          )}
                          {issue.is_circuit_breaker && (
                            <span className="ml-auto flex items-center gap-1 text-[10px] font-mono text-status-warning shrink-0">
                              <Shield className="w-2.5 h-2.5" />
                              {e.circuit_breaker}
                            </span>
                          )}
                        </button>

                        <>
                          {isExpanded && (
                            <div
                              className="animate-fade-slide-in overflow-hidden"
                            >
                              <div className="px-3 pb-3 space-y-2 border-t border-primary/10 pt-2 mx-2">
                                <p className="typo-body text-foreground">
                                  {issue.description}
                                </p>
                                {issue.suggested_fix && (
                                  <div className="rounded-card bg-secondary/40 p-2.5">
                                    <div className="flex items-center gap-1 mb-1">
                                      <Wrench className="w-2.5 h-2.5 text-foreground" />
                                      <span className="text-[10px] font-mono text-foreground uppercase tracking-wider">
                                        {e.suggested_fix}
                                      </span>
                                    </div>
                                    <p className="typo-code text-foreground">
                                      {issue.suggested_fix}
                                    </p>
                                  </div>
                                )}
                                <div className="flex items-center gap-3 text-[10px] font-mono text-foreground">
                                  <span>{tx(e.category_label, { category: issue.category })}</span>
                                  <span>{tx(e.status_label, { status: issue.status })}</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Retry chain */}
              {retryChain.length > 1 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-mono text-foreground uppercase tracking-wider">
                    {e.retry_chain}
                  </div>
                  <div className="flex items-center gap-1">
                    {retryChain.map((exec, i) => (
                      <div key={exec.id} className="flex items-center gap-1">
                        <div className={`px-2 py-0.5 rounded-card text-[11px] font-mono border ${
                          exec.id === execution.id
                            ? 'bg-status-info/15 text-status-info border-status-info/25'
                            : exec.status === 'completed'
                              ? 'bg-status-success/10 text-status-success border-status-success/20'
                              : 'bg-status-error/10 text-status-error border-status-error/20'
                        }`}>
                          #{exec.retry_count}
                          {exec.status === 'completed' && (
                            <CheckCircle2 className="w-2.5 h-2.5 inline ml-1" />
                          )}
                        </div>
                        {i < retryChain.length - 1 && (
                          <span className="text-foreground">→</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* No issues found */}
              {issues.length === 0 && !loading && (
                <p className="typo-body text-foreground italic">
                  {e.no_healing_issues}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const { t } = useTranslation();
  // critical/medium/low map cleanly to status-* tokens. "high" sits between
  // status-error (critical) and status-warning (medium) in the severity scale
  // — orange-500 keeps the visual hierarchy intact until a status-error-strong
  // or matching shade lands in the token system.
  const cls = severity === 'critical'
    ? 'bg-status-error/20 text-status-error border-status-error/30'
    : severity === 'high'
      ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
      : severity === 'medium'
        ? 'bg-status-warning/20 text-status-warning border-status-warning/30'
        : 'bg-primary/10 text-foreground border-primary/15';

  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-mono uppercase rounded border shrink-0 ${cls}`}>
      {tokenLabel(t, 'severity', severity)}
    </span>
  );
}
