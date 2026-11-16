import { Check, X, AlertTriangle } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import { useTranslation } from '@/i18n/useTranslation';

interface BulkActionBarProps {
  activeSelectionCount: number;
  confirmAction: ManualReviewStatus | null;
  isBulkProcessing: boolean;
  onConfirmAction: (action: ManualReviewStatus | null) => void;
  onBulkAction: (status: ManualReviewStatus) => void;
  onDeselect: () => void;
}

export function BulkActionBar({
  activeSelectionCount,
  confirmAction,
  isBulkProcessing,
  onConfirmAction,
  onBulkAction,
  onDeselect,
}: BulkActionBarProps) {
  const { t, tx } = useTranslation();
  return (
    <>
      {activeSelectionCount > 0 && (
        <div
          className="animate-fade-slide-in flex-shrink-0 border-t border-hair bg-surface-1 backdrop-blur-sm px-4 py-3"
        >
          {confirmAction ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 typo-body">
                <AlertTriangle className="w-4 h-4 text-status-warning" />
                <span className="text-foreground">
                  {confirmAction === 'approved' ? t.overview.review.approve : t.overview.review.reject}{' '}
                  {tx(activeSelectionCount === 1 ? t.overview.review.confirm_bulk_one : t.overview.review.confirm_bulk, { count: activeSelectionCount })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => onConfirmAction(null)} disabled={isBulkProcessing}>
                  {t.common.cancel}
                </Button>
                <Button variant="accent" tone={confirmAction === 'approved' ? 'success' : 'error'} size="sm" onClick={() => onBulkAction(confirmAction)} disabled={isBulkProcessing}>
                  {isBulkProcessing ? t.overview.review.processing : t.common.confirm}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="typo-body text-foreground">
                <span className="font-semibold text-ink-2">{activeSelectionCount}</span>{' '}
                {activeSelectionCount !== 1 ? t.overview.review.pending_selected : t.overview.review.pending_selected_one}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={onDeselect}>
                  {t.overview.review.deselect}
                </Button>
                <Button variant="accent" tone="success" size="sm" onClick={() => onConfirmAction('approved')} icon={<Check className="w-3.5 h-3.5" />}>
{t.overview.review.approve_all}
</Button>
                <Button variant="danger" size="sm" onClick={() => onConfirmAction('rejected')} icon={<X className="w-3.5 h-3.5" />}>
{t.overview.review.reject_all}
</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
