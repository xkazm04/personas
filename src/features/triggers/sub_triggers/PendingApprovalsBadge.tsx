import { ShieldAlert } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePendingTriggerFires } from '@/features/triggers/hooks/usePendingTriggerFires';

interface PendingApprovalsBadgeProps {
  /** Scope to one agent's triggers. Omit for the workspace-wide count. */
  personaId?: string;
  /** Called when the badge is clicked — e.g. to reveal the approvals panel. */
  onClick?: () => void;
}

/**
 * "N fires waiting on you" pill. Collapses to nothing at zero, so it can sit
 * permanently in a header without adding chrome to the common case — the point
 * is that a held fire is discoverable without first knowing the panel exists.
 */
export function PendingApprovalsBadge({ personaId, onClick }: PendingApprovalsBadgeProps) {
  const { t, tx } = useTranslation();
  const { count } = usePendingTriggerFires(personaId);

  if (count === 0) return null;

  const label = tx(
    count === 1 ? t.triggers.pending_approval.badge_one : t.triggers.pending_approval.badge_other,
    { count },
  );

  const className =
    'inline-flex items-center gap-1.5 px-2 py-1 rounded-card border border-amber-500/25 bg-amber-500/10 text-amber-300 typo-caption font-medium';

  if (!onClick) {
    return (
      <span data-testid="pending-approvals-badge" className={className}>
        <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid="pending-approvals-badge"
      onClick={onClick}
      title={t.triggers.pending_approval.badge_title}
      className={`${className} hover:bg-amber-500/20 transition-colors`}
    >
      <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
      {label}
    </button>
  );
}
