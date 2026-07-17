import type { ReactNode } from 'react';
import { Zap, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { SEVERITY_COLORS, badgeClass, type BadgeColors } from '@/lib/utils/formatters';
import { SEVERITY_STYLES } from '@/lib/utils/designTokens';

/**
 * Shared branch logic for the four-way healing-issue status badge
 * (circuit-breaker / auto-fix-pending / auto-fixed / severity), plus the
 * companion "retry" chip shown when a retry execution is attached.
 *
 * `IssuesList` and `HealingIssueModal` previously re-implemented this exact
 * `is_circuit_breaker` → `status==='auto_fix_pending'` → `auto_fixed &&
 * resolved` → severity ladder independently, with a genuinely different
 * visual density (compact list row vs. modal header) — so this component
 * keeps that per-surface styling as a `variant` rather than forcing one
 * look, while centralizing the *logic* so a new status only needs handling
 * in one place.
 */

export interface HealingIssueStatusInput {
  severity: string;
  status: string;
  auto_fixed: boolean;
  is_circuit_breaker: boolean;
  execution_id?: string | null;
}

interface HealingIssueStatusBadgeProps {
  issue: HealingIssueStatusInput;
  /** `compact` matches IssuesList's row chips; `detailed` matches HealingIssueModal's header. */
  variant?: 'compact' | 'detailed';
  /** Override the circuit-breaker label (e.g. a translated `<DebtText>` node). Defaults to plain English. */
  breakerLabel?: ReactNode;
}

const DEFAULT_SEVERITY: BadgeColors = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };

export function HealingIssueStatusBadge({ issue, variant = 'compact', breakerLabel }: HealingIssueStatusBadgeProps) {
  const isAutoFixed = issue.auto_fixed && issue.status === 'resolved';
  const isAutoFixPending = issue.status === 'auto_fix_pending';
  const isCircuitBreaker = issue.is_circuit_breaker;

  if (variant === 'detailed') {
    const sev = SEVERITY_COLORS[issue.severity] ?? DEFAULT_SEVERITY;
    if (isCircuitBreaker) {
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-sm font-mono uppercase rounded-card ${SEVERITY_STYLES.error.bg} ${SEVERITY_STYLES.error.text} ${SEVERITY_STYLES.error.border}`}>
          <Zap className="w-3 h-3" /> {breakerLabel ?? 'circuit breaker'}
        </span>
      );
    }
    if (isAutoFixPending) {
      return (
        <StatusBadge variant="warning" icon={<LoadingSpinner size="xs" />} className="text-sm font-mono uppercase rounded-card">
          retrying
        </StatusBadge>
      );
    }
    if (isAutoFixed) {
      return (
        <StatusBadge variant="success" icon={<CheckCircle className="w-3 h-3" />} className="text-sm font-mono uppercase rounded-card">
          auto-fixed
        </StatusBadge>
      );
    }
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-sm font-mono uppercase rounded-card border ${sev.bg} ${sev.text} ${sev.border}`}>
        <AlertTriangle className="w-3 h-3" /> {issue.severity}
      </span>
    );
  }

  // compact
  const sevBadge = SEVERITY_COLORS[issue.severity] ?? SEVERITY_COLORS.medium!;
  if (isCircuitBreaker) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-code uppercase rounded-card border bg-red-500/15 text-red-400 border-red-500/25">
        <Zap className="w-3 h-3" /> breaker
      </span>
    );
  }
  if (isAutoFixPending) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-code uppercase rounded-card border bg-amber-500/15 text-amber-400 border-amber-500/20">
        <LoadingSpinner size="xs" /> retrying
      </span>
    );
  }
  if (isAutoFixed) {
    return (
      <span className="inline-flex px-1.5 py-0.5 typo-code uppercase rounded-card border bg-emerald-500/15 text-emerald-400 border-emerald-500/20">
        fixed
      </span>
    );
  }
  return (
    <span className={`inline-flex px-1.5 py-0.5 typo-code uppercase rounded-card ${badgeClass(sevBadge)} ${issue.severity === 'critical' ? 'animate-pulse' : ''}`}>
      {issue.severity}
    </span>
  );
}

interface HealingRetryChipProps {
  issue: HealingIssueStatusInput;
  variant?: 'compact' | 'detailed';
}

/** "retry" chip shown alongside the status badge when a retry execution is attached. */
export function HealingRetryChip({ issue, variant = 'compact' }: HealingRetryChipProps) {
  const isAutoFixed = issue.auto_fixed && issue.status === 'resolved';
  const isAutoFixPending = issue.status === 'auto_fix_pending';
  if (!(isAutoFixed || isAutoFixPending) || !issue.execution_id) return null;

  if (variant === 'detailed') {
    return (
      <StatusBadge accent="cyan" icon={<RefreshCw className={`w-2.5 h-2.5 ${isAutoFixPending ? 'animate-spin' : ''}`} />} className="text-sm font-mono rounded-card">
        {isAutoFixPending ? 'retry in progress' : 'healed via retry'}
      </StatusBadge>
    );
  }

  return (
    <StatusBadge
      accent="cyan"
      size="sm"
      icon={<RefreshCw className={`w-2.5 h-2.5 ${isAutoFixPending ? 'animate-spin' : ''}`} />}
      className="typo-code rounded-card"
      title={isAutoFixPending ? 'Retry in progress' : 'Auto-healed via retry'}
    >
      retry
    </StatusBadge>
  );
}
