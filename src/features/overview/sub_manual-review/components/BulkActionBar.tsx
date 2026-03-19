import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, AlertTriangle } from 'lucide-react';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';

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
  return (
    <AnimatePresence>
      {activeSelectionCount > 0 && (
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="flex-shrink-0 border-t border-primary/15 bg-secondary/40 backdrop-blur-sm px-4 py-3"
        >
          {confirmAction ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span className="text-foreground/80">
                  {confirmAction === 'approved' ? 'Approve' : 'Reject'}{' '}
                  <span className="font-semibold">{activeSelectionCount}</span> review
                  {activeSelectionCount !== 1 ? 's' : ''}?
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onConfirmAction(null)}
                  disabled={isBulkProcessing}
                  className="px-3 py-1.5 rounded-xl text-sm border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => onBulkAction(confirmAction)}
                  disabled={isBulkProcessing}
                  className={`px-3 py-1.5 rounded-xl typo-heading border transition-colors ${
                    confirmAction === 'approved'
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                      : 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25'
                  }`}
                >
                  {isBulkProcessing ? 'Processing...' : 'Confirm'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground/80">
                <span className="font-semibold text-foreground/90">{activeSelectionCount}</span>{' '}
                pending review{activeSelectionCount !== 1 ? 's' : ''} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onDeselect}
                  className="px-3 py-1.5 rounded-xl text-sm border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 transition-colors"
                >
                  Deselect
                </button>
                <button
                  onClick={() => onConfirmAction('approved')}
                  className="px-3 py-1.5 rounded-xl typo-heading bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  Approve All
                </button>
                <button
                  onClick={() => onConfirmAction('rejected')}
                  className="px-3 py-1.5 rounded-xl typo-heading bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors flex items-center gap-1.5"
                >
                  <X className="w-3.5 h-3.5" />
                  Reject All
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
