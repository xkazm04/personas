import { useState, useRef, useEffect } from 'react';
import { RefreshCw, X, CheckCircle2, XCircle, Square } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { RebuildPhase } from '@/hooks/design/core/useBackgroundRebuild';
import { BaseModal } from '../../shared/BaseModal';

interface RebuildModalProps {
  isOpen: boolean;
  onClose: () => void;
  review: PersonaDesignReview | null;
  /** Externally managed rebuild state */
  phase: RebuildPhase;
  lines: string[];
  error: string | null;
  onStartRebuild: (userDirection?: string) => void;
  onCancel: () => void;
}

export function RebuildModal({
  isOpen,
  onClose,
  review,
  phase,
  lines,
  error,
  onStartRebuild,
  onCancel,
}: RebuildModalProps) {
  const [userDirection, setUserDirection] = useState('');
  const linesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    linesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  // Reset user direction when modal opens with a new review
  useEffect(() => {
    if (isOpen) {
      setUserDirection('');
    }
  }, [isOpen, review?.id]);

  // Determine display phase: if hook phase is idle/input, show input form
  const displayPhase = phase === 'idle' ? 'input' : phase;

  if (!isOpen || !review) return null;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="rebuild-modal-title"
      maxWidthClass="max-w-2xl"
      panelClassName="max-h-[80vh] bg-background border border-primary/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
    >
        {/* Header */}
        <div className="px-6 py-4 border-b border-primary/10 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <RefreshCw className={`w-4 h-4 text-blue-400 ${displayPhase === 'processing' ? 'animate-spin' : ''}`} />
            </div>
            <div className="min-w-0">
              <h2 id="rebuild-modal-title" className="text-sm font-semibold text-foreground/90 truncate">
                Rebuild Template
              </h2>
              <p className="text-sm text-muted-foreground/60 truncate">
                {review.test_case_name}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors">
            <X className="w-4 h-4 text-muted-foreground/70" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {displayPhase === 'input' && (
            <div className="space-y-4">
              {/* Instruction context */}
              <div className="bg-secondary/30 rounded-xl border border-primary/10 p-4">
                <div className="text-sm font-medium text-muted-foreground/60 uppercase tracking-wide mb-1.5">
                  Template Instruction
                </div>
                <p className="text-sm text-foreground/80 leading-relaxed">
                  {review.instruction}
                </p>
              </div>

              {/* User direction */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground/70 mb-1.5">
                  Custom Direction (optional)
                </label>
                <textarea
                  value={userDirection}
                  onChange={(e) => setUserDirection(e.target.value)}
                  placeholder="Add specific requirements, focus areas, or constraints for this rebuild..."
                  className="w-full h-28 px-4 py-3 bg-secondary/20 border border-primary/10 rounded-xl text-sm text-foreground/90 placeholder:text-muted-foreground/40 resize-none focus-visible:outline-none focus-visible:border-violet-500/30 focus-visible:ring-1 focus-visible:ring-violet-500/20 transition-colors"
                />
                <p className="text-sm text-muted-foreground/60 mt-1">
                  The rebuild will regenerate all 9 data dimensions using the Protocol System.
                </p>
              </div>
            </div>
          )}

          {displayPhase === 'processing' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-blue-400/80">
                <LoadingSpinner size="sm" />
                <span>Rebuilding template with Claude CLI...</span>
              </div>

              {/* Streaming output */}
              <div className="bg-[#0d1117] rounded-xl border border-primary/10 p-4 h-64 overflow-y-auto font-mono text-sm leading-relaxed">
                {lines.length === 0 && (
                  <span className="text-muted-foreground/60">Waiting for output...</span>
                )}
                {lines.map((line, i) => {
                  const isMilestone = line.startsWith('[Milestone]');
                  return (
                    <div
                      key={i}
                      className={
                        isMilestone
                          ? 'text-blue-400/80 font-semibold mt-2 first:mt-0'
                          : 'text-muted-foreground/70'
                      }
                    >
                      {line}
                    </div>
                  );
                })}
                <div ref={linesEndRef} />
              </div>

              <p className="text-sm text-muted-foreground/60 text-center">
                You can close this dialog -- the rebuild will continue in the background.
              </p>
            </div>
          )}

          {displayPhase === 'completed' && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 mb-4">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </div>
              <h3 className="text-sm font-semibold text-foreground/90 mb-1">
                Rebuild Complete
              </h3>
              <p className="text-sm text-muted-foreground/60 max-w-sm">
                The template has been regenerated with all data dimensions.
                The gallery will refresh to show updated scores.
              </p>
            </div>
          )}

          {displayPhase === 'failed' && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
                <XCircle className="w-8 h-8 text-red-400" />
              </div>
              <h3 className="text-sm font-semibold text-foreground/90 mb-1">
                Rebuild Failed
              </h3>
              <p className="text-sm text-muted-foreground/60 max-w-sm">
                {error || 'An unknown error occurred during rebuild.'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-primary/10 flex items-center justify-end gap-3">
          {displayPhase === 'input' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-xl text-muted-foreground/70 hover:bg-secondary/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => onStartRebuild(userDirection)}
                className="px-4 py-2 text-sm rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Start Rebuild
              </button>
            </>
          )}

          {displayPhase === 'processing' && (
            <div className="flex items-center gap-2">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm rounded-xl text-red-400/70 border border-red-500/20 hover:bg-red-500/10 transition-colors flex items-center gap-2"
              >
                <Square className="w-3 h-3" />
                Cancel Rebuild
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-xl bg-secondary/50 text-foreground/80 hover:bg-secondary/70 transition-colors"
              >
                Run in Background
              </button>
            </div>
          )}

          {(displayPhase === 'completed' || displayPhase === 'failed') && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-xl bg-secondary/50 text-foreground/80 hover:bg-secondary/70 transition-colors"
            >
              Close
            </button>
          )}
        </div>
    </BaseModal>
  );
}
