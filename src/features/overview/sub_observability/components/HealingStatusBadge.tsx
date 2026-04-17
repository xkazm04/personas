import { Zap, CheckCircle, AlertTriangle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { SEVERITY_COLORS, badgeClass } from '@/lib/utils/formatters';
import { SEVERITY_STYLES } from '@/lib/utils/designTokens';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';

interface HealingStatusBadgeProps {
  issue: PersonaHealingIssue;
  variant?: 'compact' | 'full';
}

export function HealingStatusBadge({ issue, variant = 'compact' }: HealingStatusBadgeProps) {
  const isAutoFixed = issue.auto_fixed && issue.status === 'resolved';
  const isAutoFixPending = issue.status === 'auto_fix_pending';
  const isCircuitBreaker = issue.is_circuit_breaker;
  const px = variant === 'full' ? 'px-2' : 'px-1.5';
  const py = 'py-0.5';

  if (isCircuitBreaker) {
    return (
      <span className={`inline-flex items-center gap-1 ${px} ${py} typo-code uppercase rounded-card border ${variant === 'full' ? `${SEVERITY_STYLES.error.bg} ${SEVERITY_STYLES.error.text} ${SEVERITY_STYLES.error.border}` : 'bg-red-500/15 text-red-400 border-red-500/25'}`}>
        <Zap className="w-3 h-3" /> {variant === 'full' ? 'circuit breaker' : 'breaker'}
      </span>
    );
  }

  if (isAutoFixPending) {
    return (
      <span className={`inline-flex items-center gap-1 ${px} ${py} typo-code uppercase rounded-card border bg-amber-500/15 text-amber-400 border-amber-500/20`}>
        <LoadingSpinner size="xs" /> retrying
      </span>
    );
  }

  if (isAutoFixed) {
    return (
      <span className={`inline-flex items-center gap-1 ${px} ${py} typo-code uppercase rounded-card border bg-emerald-500/15 text-emerald-400 border-emerald-500/20`}>
        {variant === 'full' && <CheckCircle className="w-3 h-3" />} {variant === 'full' ? 'auto-fixed' : 'fixed'}
      </span>
    );
  }

  const sevBadge = SEVERITY_COLORS[issue.severity] ?? SEVERITY_COLORS.medium!;
  return (
    <span className={`inline-flex items-center gap-1 ${px} ${py} typo-code uppercase rounded-card border ${variant === 'full' ? `${sevBadge.bg} ${sevBadge.text} ${sevBadge.border}` : badgeClass(sevBadge)} ${issue.severity === 'critical' ? 'animate-pulse' : ''}`}>
      {variant === 'full' && <AlertTriangle className="w-3 h-3" />} {issue.severity}
    </span>
  );
}
