import { useState, useEffect, useRef } from 'react';
import { Check, AlertTriangle, RotateCcw } from 'lucide-react';
import type { AgentIR } from '@/lib/types/designTypes';
import type { FailedOperation } from '@/hooks/design/credential/applyDesignResult';
import { DesignPhaseAppliedDetails } from './DesignPhaseAppliedDetails';
import { useTranslation } from '@/i18n/useTranslation';

interface DesignPhaseAppliedProps {
  result: AgentIR | null;
  warnings?: string[];
  failedOperations?: FailedOperation[];
  onRetryFailed?: () => void;
  onReset: () => void;
}

export function DesignPhaseApplied({ result, warnings = [], failedOperations = [], onRetryFailed, onReset }: DesignPhaseAppliedProps) {
  const { t, tx } = useTranslation();
  const hasFailures = failedOperations.length > 0;
  const hasWarnings = warnings.length > 0 || hasFailures;
  const [retrying, setRetrying] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  return (
    <div
      key="applied"
      className="animate-fade-slide-in flex flex-col items-center py-8 gap-6"
      ref={containerRef}
      tabIndex={-1}
    >
      {/* Animated success checkmark */}
      <div className="relative">
        <div
          className={`animate-fade-slide-in w-14 h-14 rounded-full flex items-center justify-center ${
            hasWarnings
              ? 'bg-amber-500/15 ring-2 ring-amber-500/30'
              : 'bg-emerald-500/15 ring-2 ring-emerald-500/30'
          }`}
        >
          <div className="animate-fade-scale-in"
          >
            {hasWarnings
              ? <AlertTriangle className="w-6 h-6 text-amber-400" />
              : <Check className="w-6 h-6 text-emerald-400" strokeWidth={3} />
            }
          </div>
        </div>
        {/* Expanding pulse ring on success */}
        {!hasWarnings && (
          <div
            className="animate-fade-slide-in absolute inset-0 rounded-full ring-2 ring-emerald-500/40"
          />
        )}
      </div>

      {/* Title + summary */}
      <div
        className="animate-fade-slide-in text-center"
      >
        <h3 className={`text-base font-semibold ${hasWarnings ? 'text-amber-400' : 'text-emerald-400'}`}>
          {hasWarnings ? tx(warnings.length === 1 ? t.agents.design.applied_with_warnings_one : t.agents.design.applied_with_warnings_other, { count: warnings.length }) : t.agents.design.agent_configured}
        </h3>
        {result?.summary && (
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-xs mx-auto line-clamp-2">
            {result.summary}
          </p>
        )}
      </div>

      {/* Failed operations banner */}
      {hasFailures && (
        <div
          className="animate-fade-slide-in w-full max-w-sm px-3 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20"
        >
          <p className="text-xs font-medium text-amber-400 mb-2">
            {tx(failedOperations.length === 1 ? t.agents.design.operations_failed_one : t.agents.design.operations_failed_other, { count: failedOperations.length })}
          </p>
          <ul className="space-y-1.5 mb-3">
            {failedOperations.map((op, i) => (
              <li key={i} className="text-sm text-amber-400/90 flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0 text-amber-500">{op.kind === 'trigger' ? '⚡' : '📡'}</span>
                <span>
                  <span className="font-medium">{op.label}</span>
                  <span className="block text-xs text-amber-400/60">{op.error}</span>
                </span>
              </li>
            ))}
          </ul>
          {onRetryFailed && (
            <button
              onClick={async () => {
                setRetrying(true);
                try { await onRetryFailed(); } finally { setRetrying(false); }
              }}
              disabled={retrying}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 transition-colors disabled:opacity-50"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
              {retrying ? t.agents.design.retrying : tx(t.agents.design.retry_failed, { count: failedOperations.length })}
            </button>
          )}
        </div>
      )}

      {/* Generic warnings (non-structured) */}
      {!hasFailures && warnings.length > 0 && (
        <div
          className="animate-fade-slide-in w-full max-w-sm px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20"
        >
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="text-sm text-amber-400/90 flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0">*</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Stats + Next steps (extracted component) */}
      <DesignPhaseAppliedDetails result={result} onReset={onReset} />

      {/* Subtle close link */}
      <button
        onClick={onReset}
        className="animate-fade-slide-in mt-1 text-sm text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
      >
        {t.common.close}
      </button>
    </div>
  );
}
