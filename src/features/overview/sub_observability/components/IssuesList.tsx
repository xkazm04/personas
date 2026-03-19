import { Zap, RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { SEVERITY_COLORS, HEALING_CATEGORY_COLORS, badgeClass } from '@/lib/utils/formatters';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';

interface IssuesListProps {
  issues: PersonaHealingIssue[];
  onSelectIssue: (issue: PersonaHealingIssue) => void;
  onResolve: (id: string) => void;
}

export function IssuesList({ issues, onSelectIssue, onResolve }: IssuesListProps) {
  return (
    <div className="divide-y divide-primary/5 bg-gradient-to-b from-transparent to-black/[0.02]">
      {issues.map((issue) => {
        const sevBadge = SEVERITY_COLORS[issue.severity] ?? SEVERITY_COLORS.medium!;
        const age = Math.floor((Date.now() - new Date(issue.created_at).getTime()) / (1000 * 60 * 60));
        const ageLabel = age < 1 ? 'just now' : age < 24 ? `${age}h ago` : `${Math.floor(age / 24)}d ago`;
        const isAutoFixed = issue.auto_fixed && issue.status === 'resolved';
        const isAutoFixPending = issue.status === 'auto_fix_pending';
        const isCircuitBreaker = issue.is_circuit_breaker;

        return (
          <div key={issue.id} className={`flex items-center gap-4 px-4 py-4 hover:bg-white/[0.03] transition-colors group cursor-pointer ${isAutoFixed ? 'opacity-70' : ''} ${isCircuitBreaker ? 'bg-red-500/5' : ''}`}>
            {isCircuitBreaker ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono uppercase rounded-lg border bg-red-500/15 text-red-400 border-red-500/25">
                <Zap className="w-3 h-3" /> breaker
              </span>
            ) : isAutoFixPending ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono uppercase rounded-lg border bg-amber-500/15 text-amber-400 border-amber-500/20">
                <LoadingSpinner size="xs" /> retrying
              </span>
            ) : isAutoFixed ? (
              <span className="inline-flex px-1.5 py-0.5 text-sm font-mono uppercase rounded-lg border bg-emerald-500/15 text-emerald-400 border-emerald-500/20">
                fixed
              </span>
            ) : (
              <span className={`inline-flex px-1.5 py-0.5 text-sm font-mono uppercase rounded-lg ${badgeClass(sevBadge)} ${
                issue.severity === 'critical' ? 'animate-pulse' :
                issue.severity === 'high' ? 'animate-pulse' :
                issue.severity === 'medium' ? 'animate-[pulse_3s_ease-in-out_infinite]' : ''
              }`}>
                {issue.severity}
              </span>
            )}
            {(isAutoFixed || isAutoFixPending) && issue.execution_id && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" title={isAutoFixPending ? 'Retry in progress' : 'Auto-healed via retry'}>
                <RefreshCw className={`w-2.5 h-2.5 ${isAutoFixPending ? 'animate-spin' : ''}`} /> retry
              </span>
            )}
            <button
              onClick={() => onSelectIssue(issue)}
              className={`flex-1 text-left text-sm transition-colors line-clamp-2 ${isCircuitBreaker ? 'text-red-400/90 hover:text-red-300 font-medium' : isAutoFixed ? 'text-foreground/90 line-through decoration-emerald-500/30' : 'text-foreground/80 hover:text-foreground'}`}
            >
              {issue.title}
            </button>
            <span className={`text-sm font-mono min-w-[90px] text-right ${HEALING_CATEGORY_COLORS[issue.category]?.text || 'text-muted-foreground/80'}`}>
              {issue.category}
            </span>
            <span className="text-sm text-muted-foreground/80 w-16 text-right">{ageLabel}</span>
            {!isAutoFixed && !isAutoFixPending && (
              <button
                onClick={() => onResolve(issue.id)}
                className="px-2 py-1 typo-heading text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors"
              >
                Resolve
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
