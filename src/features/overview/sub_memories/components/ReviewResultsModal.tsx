import { motion } from 'framer-motion';
import { Sparkles, X, CheckCircle2, Trash2, AlertCircle } from 'lucide-react';
import type { MemoryReviewResult } from '@/api/overview/memories';

interface ReviewResultsModalProps {
  reviewResult: MemoryReviewResult | null;
  reviewError: string | null;
  onClose: () => void;
}

export default function ReviewResultsModal({ reviewResult, reviewError, onClose }: ReviewResultsModalProps) {
  if (!reviewResult && !reviewError) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-2xl mx-4 bg-background border border-primary/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-primary/10 flex-shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <h3 className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              AI Memory Review
            </h3>
            {reviewResult && (
              <p className="text-sm text-muted-foreground/80 mt-1">
                Reviewed {reviewResult.reviewed} memories
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/90 hover:text-foreground/95 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {reviewError ? (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-300">Review failed</p>
                <p className="text-sm text-red-400/70 mt-1">{reviewError}</p>
              </div>
            </div>
          ) : reviewResult ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-sm font-medium text-emerald-300">{reviewResult.updated} kept</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20">
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  <span className="text-sm font-medium text-red-300">{reviewResult.deleted} pruned</span>
                </div>
              </div>

              {reviewResult.details.length > 0 && (
                <div className="space-y-1.5">
                  {reviewResult.details.map((d) => (
                    <div
                      key={d.id}
                      className={`flex items-start gap-3 px-3 py-2 rounded-xl border ${
                        d.action === 'deleted' ? 'bg-red-500/5 border-red-500/15' : 'bg-emerald-500/5 border-emerald-500/15'
                      }`}
                    >
                      <span className={`text-sm font-bold px-1.5 py-0.5 rounded-lg flex-shrink-0 mt-0.5 ${
                        d.score >= 7 ? 'bg-emerald-500/15 text-emerald-400' : d.score >= 4 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
                      }`}>
                        {d.score}/10
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium truncate ${d.action === 'deleted' ? 'text-foreground/50 line-through' : 'text-foreground/80'}`}>
                          {d.title}
                        </p>
                        <p className="text-sm text-muted-foreground/70 mt-0.5">{d.reason}</p>
                      </div>
                      <span className={`text-sm font-medium flex-shrink-0 ${d.action === 'deleted' ? 'text-red-400/70' : 'text-emerald-400/70'}`}>
                        {d.action}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
}
