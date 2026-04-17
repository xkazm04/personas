import { Check, X, AlertTriangle } from 'lucide-react';
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
  const { t } = useTranslation();
  return (
    <>
      {activeSelectionCount > 0 && (
        <div
          className="animate-fade-slide-in flex-shrink-0 border-t border-primary/15 bg-secondary/40 backdrop-blur-sm px-4 py-3"
        >
          {confirmAction ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span className="text-foreground">
                  {confirmAction === 'approved' ? t.overview.review.approve : t.overview.review.reject}{' '}
                  <span className="font-semibold">{activeSelectionCount}</span> review
                  {activeSelectionCount !== 1 ? 's' : ''}?
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onConfirmAction(null)}
                  disabled={isBulkProcessing}
                  className="px-3 py-1.5 rounded-modal text-sm border border-primary/15 text-foreground hover:bg-secondary/50 transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={() => onBulkAction(confirmAction)}
                  disabled={isBulkProcessing}
                  className={`px-3 py-1.5 rounded-modal typo-heading border transition-colors ${
                    confirmAction === 'approved'
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                      : 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25'
                  }`}
                >
                  {isBulkProcessing ? t.overview.review.processing : t.common.confirm}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                <span className="font-semibold text-foreground/90">{activeSelectionCount}</span>{' '}
                pending review{activeSelectionCount !== 1 ? 's' : ''} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onDeselect}
                  className="px-3 py-1.5 rounded-modal text-sm border border-primary/15 text-foreground hover:bg-secondary/50 transition-colors"
                >
                  {t.overview.review.deselect}
                </button>
                <button
                  onClick={() => onConfirmAction('approved')}
                  className="px-3 py-1.5 rounded-modal typo-heading bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  {t.overview.review.approve_all}
                </button>
                <button
                  onClick={() => onConfirmAction('rejected')}
                  className="px-3 py-1.5 rounded-modal typo-heading bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors flex items-center gap-1.5"
                >
                  <X className="w-3.5 h-3.5" />
                  {t.overview.review.reject_all}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
