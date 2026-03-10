import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Wrench,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { SEVERITY_STYLES } from '@/lib/utils/designTokens';
import type { DryRunIssue } from './types';

// ── Severity icon map ────────────────────────────────────────────

const SEVERITY_ICONS: Record<DryRunIssue['severity'], typeof AlertTriangle> = {
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

// ── Issue card ───────────────────────────────────────────────────

export interface HealthIssueCardProps {
  issue: DryRunIssue;
  personaId: string;
  onApplyFix: (issue: DryRunIssue) => void;
  onResolved: (id: string) => void;
}

export function HealthIssueCard({ issue, onApplyFix, onResolved }: HealthIssueCardProps) {
  const style = SEVERITY_STYLES[issue.severity];
  const Icon = SEVERITY_ICONS[issue.severity];

  const handleApply = () => {
    onApplyFix(issue);
    onResolved(issue.id);
  };

  if (issue.resolved) {
    return (
      <motion.div
        initial={{ opacity: 0.5 }}
        animate={{ opacity: 1 }}
        className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl ${SEVERITY_STYLES.success.border} ${SEVERITY_STYLES.success.bg}`}
      >
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
        <span className="text-sm text-muted-foreground/50 line-through leading-relaxed">
          {issue.description}
        </span>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`px-3 py-2.5 rounded-xl ${style.border} ${style.bg}`}
    >
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
    </motion.div>
  );
}
