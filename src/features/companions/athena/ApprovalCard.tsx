import { Check, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';
import type { ApprovalOutcome, PendingApproval } from '@/api/companion';
import { actionLabel } from './athenaLabels';
import { useApprovalCard } from './useApprovalCard';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
/**
 * Inline card rendered in the chat for each `propose_action` op Athena
 * emits. Approving runs the underlying action; rejecting just closes the
 * card and logs an episode.
 */
export function ApprovalCard({
  approval,
  onResolved,
}: {
  approval: PendingApproval;
  onResolved: (id: string, status: ApprovalOutcome['status']) => void;
}) {
  const { t } = useTranslation();
  // The verbs live in `useApprovalCard` so card-native surfaces share them.
  const { busy, error, failedOutcome, prettyParams, approve, reject } = useApprovalCard(approval, onResolved);

  return (
    <div
      className="rounded-card border border-primary/40 bg-background/60 [[data-theme^='light']_&]:bg-surface-2 p-3.5 space-y-3 typo-body shadow-elevation-1"
      data-companion-approval
      data-companion-approval-id={approval.id}
      data-companion-approval-action={approval.action}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 typo-caption text-primary">
          {t.athena.proposed_action}
        </span>
        <Tooltip content={approval.action}>
          <span
            className="typo-caption text-ink-2 px-2 py-0.5 rounded-input bg-foreground/5"
          >
            {actionLabel(t, approval.action)}
          </span>
        </Tooltip>
      </div>

      {approval.rationale && (
        <p className="text-foreground leading-relaxed">{approval.rationale}</p>
      )}

      <details className="text-foreground">
        <summary className="cursor-pointer typo-caption hover:text-foreground transition-colors">
          {t.athena.action_params}
        </summary>
        <div className="mt-1.5">
          <MarkdownRenderer
            content={'```json\n' + prettyParams + '\n```'}
            className="athena-chat-md"
            codeBlockActions
          />
        </div>
      </details>

      {error && (
        <div className="rounded-card border border-status-error/30 bg-status-error/10 px-2.5 py-1.5 typo-caption text-status-error">
          {error}
        </div>
      )}

      {failedOutcome && (
        <div className="rounded-card border border-status-warning/30 bg-status-warning/10 px-2.5 py-1.5 typo-caption text-status-warning">
          {t.athena.approved_failed.replace(
            '{message}',
            failedOutcome,
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={approve}
          disabled={busy !== null}
          loading={busy === 'approve'}
          icon={<Check className="w-3.5 h-3.5" />}
          data-testid="companion-approve"
        >
          {t.athena.approve}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={reject}
          disabled={busy !== null}
          loading={busy === 'reject'}
          icon={<X className="w-3.5 h-3.5" />}
          data-testid="companion-reject"
        >
          {t.athena.reject}
        </Button>
      </div>
    </div>
  );
}
