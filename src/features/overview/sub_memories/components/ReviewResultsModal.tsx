import { Sparkles, X, CheckCircle2, Trash2, AlertCircle } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import type { MemoryReviewResult } from '@/api/overview/memories';
import { useTranslation } from '@/i18n/useTranslation';

interface ReviewResultsModalProps {
  reviewResult: MemoryReviewResult | null;
  reviewError: string | null;
  onClose: () => void;
}

export default function ReviewResultsModal({ reviewResult, reviewError, onClose }: ReviewResultsModalProps) {
  const { t } = useTranslation();
  if (!reviewResult && !reviewError) return null;

  return (
    <BaseModal isOpen onClose={onClose} titleId="review-results-title" size="lg" panelClassName="bg-background border border-primary/20 rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-primary/10 flex-shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <h3 id="review-results-title" className="typo-heading text-foreground/90 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              {t.overview.review_results.title}
            </h3>
            {reviewResult && (
              <p className="typo-body text-foreground mt-1">
                Reviewed {reviewResult.reviewed} memories
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground hover:text-foreground/95 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {reviewError ? (
            <div className="flex items-start gap-3 p-4 rounded-modal bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="typo-heading text-red-300">{t.overview.review_results.review_failed}</p>
                <p className="typo-body text-red-400/70 mt-1">{reviewError}</p>
              </div>
            </div>
          ) : reviewResult ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="typo-heading text-emerald-300">{reviewResult.updated} kept</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal bg-red-500/10 border border-red-500/20">
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  <span className="typo-heading text-red-300">{reviewResult.deleted} pruned</span>
                </div>
              </div>

              {reviewResult.details.length > 0 && (
                <div className="space-y-1.5">
                  {reviewResult.details.map((d) => (
                    <div
                      key={d.id}
                      className={`flex items-start gap-3 px-3 py-2 rounded-modal border ${
                        d.action === 'deleted' ? 'bg-red-500/5 border-red-500/15' : 'bg-emerald-500/5 border-emerald-500/15'
                      }`}
                    >
                      <span className={`typo-heading px-1.5 py-0.5 rounded-card flex-shrink-0 mt-0.5 ${
                        d.score >= 7 ? 'bg-emerald-500/15 text-emerald-400' : d.score >= 4 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
                      }`}>
                        {d.score}/10
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={`typo-heading truncate ${d.action === 'deleted' ? 'text-foreground line-through' : 'text-foreground'}`}>
                          {d.title}
                        </p>
                        <p className="typo-body text-foreground mt-0.5">{d.reason}</p>
                      </div>
                      <span className={`typo-heading flex-shrink-0 ${d.action === 'deleted' ? 'text-red-400/70' : 'text-emerald-400/70'}`}>
                        {d.action}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
    </BaseModal>
  );
}
