import { type Dispatch } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, Wrench } from 'lucide-react';
import type { DryRunResult, DryRunIssue } from './builder/types';
import type { BuilderAction } from './builder/builderReducer';
import { FEASIBILITY_COLORS, SEVERITY_STYLES } from '@/lib/utils/designTokens';

// ── Severity styling ────────────────────────────────────────────────

const SEVERITY_ICONS: Record<DryRunIssue['severity'], typeof AlertTriangle> = {
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

// ── IssueCard ───────────────────────────────────────────────────────

interface IssueCardProps {
  issue: DryRunIssue;
  dispatch: Dispatch<BuilderAction>;
  onResolved: (id: string) => void;
}

function IssueCard({ issue, dispatch, onResolved }: IssueCardProps) {
  const style = SEVERITY_STYLES[issue.severity];
  const Icon = SEVERITY_ICONS[issue.severity];

  const handleApply = () => {
    if (!issue.proposal) return;
    for (const action of issue.proposal.actions) {
      dispatch(action);
    }
    onResolved(issue.id);
  };

  if (issue.resolved) {
    return (
      <div className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl ${SEVERITY_STYLES.success.border} ${SEVERITY_STYLES.success.bg}`}>
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
        <span className="text-sm text-muted-foreground/50 line-through leading-relaxed">
          {issue.description}
        </span>
      </div>
    );
  }

  return (
    <div className={`px-3 py-2.5 rounded-xl ${style.border} ${style.bg}`}>
      <div className="flex items-start gap-2.5">
        <Icon className={`w-3.5 h-3.5 ${style.text} mt-0.5 shrink-0`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground/80 leading-relaxed">
            {issue.description}
          </p>
          {issue.proposal ? (
            <button
              type="button"
              onClick={handleApply}
              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
            >
              <Wrench className="w-3 h-3" />
              Apply Fix: {issue.proposal.label}
            </button>
          ) : (
            <p className="mt-1.5 text-sm text-muted-foreground/50 italic">
              Manual action needed
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── DryRunPanel ─────────────────────────────────────────────────────

interface DryRunPanelProps {
  result: DryRunResult;
  dispatch: Dispatch<BuilderAction>;
  onIssueResolved: (issueId: string) => void;
}

export function DryRunPanel({ result, dispatch, onIssueResolved }: DryRunPanelProps) {
  const statusTokens = (FEASIBILITY_COLORS[result.status] ?? FEASIBILITY_COLORS['partial'])!;

  const StatusIcon = result.status === 'ready'
    ? CheckCircle2
    : result.status === 'blocked'
      ? XCircle
      : AlertTriangle;

  const statusLabel = result.status === 'ready'
    ? 'Ready'
    : result.status === 'blocked'
      ? 'Blocked'
      : 'Partial';

  const remainingIssues = result.issues.filter((i) => !i.resolved).length;

  return (
    <div className="space-y-3">
      {/* Status badge */}
      <div className="flex items-center gap-2">
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-medium ${statusTokens.bgColor} ${statusTokens.color} border ${statusTokens.borderColor}`}>
          <StatusIcon className="w-3.5 h-3.5" />
          {statusLabel}
        </div>
        {remainingIssues > 0 && (
          <span className="text-sm text-muted-foreground/60">
            {remainingIssues} issue{remainingIssues !== 1 ? 's' : ''} remaining
          </span>
        )}
      </div>

      {/* Confirmed capabilities */}
      {result.capabilities.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-muted-foreground/60 uppercase tracking-wider">
            Capabilities
          </p>
          <div className="space-y-1">
            {result.capabilities.map((cap, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-emerald-400/80">
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                <span className="text-foreground/70">{cap}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Issues */}
      {result.issues.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-muted-foreground/60 uppercase tracking-wider">
            Issues
          </p>
          <div className="space-y-2">
            {result.issues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                dispatch={dispatch}
                onResolved={onIssueResolved}
              />
            ))}
          </div>
        </div>
      )}

      {/* All clear */}
      {result.issues.length === 0 && result.capabilities.length > 0 && (
        <p className="text-sm text-emerald-400/70">
          No issues found. Your agent configuration looks good.
        </p>
      )}
    </div>
  );
}
