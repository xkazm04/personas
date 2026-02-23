import { useState, useRef, useEffect, useCallback } from 'react';
import { RefreshCw, X, Loader2, CheckCircle2, XCircle, Square } from 'lucide-react';
import { rebuildDesignReview, getRebuildSnapshot, cancelRebuild } from '@/api/reviews';
import { useBackgroundSnapshot } from '@/hooks/utility/useBackgroundSnapshot';
import type { SnapshotLike } from '@/hooks/utility/useBackgroundSnapshot';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

type Phase = 'input' | 'processing' | 'completed' | 'failed';

interface RebuildModalProps {
  isOpen: boolean;
  onClose: () => void;
  review: PersonaDesignReview;
  onCompleted: () => void;
}

export function RebuildModal({ isOpen, onClose, review, onCompleted }: RebuildModalProps) {
  const [phase, setPhase] = useState<Phase>('input');
  const [userDirection, setUserDirection] = useState('');
  const [rebuildId, setRebuildId] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const linesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    linesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  // Reset state when modal opens with a new review
  useEffect(() => {
    if (isOpen) {
      setPhase('input');
      setUserDirection('');
      setRebuildId(null);
      setLines([]);
      setError(null);
    }
  }, [isOpen, review.id]);

  const getSnapshot = useCallback(
    async (id: string): Promise<SnapshotLike> => {
      const snap = await getRebuildSnapshot(id);
      return {
        status: snap.status,
        error: snap.error,
        lines: snap.lines,
        draft: null,
        questions: null,
      };
    },
    [],
  );

  const handleLines = useCallback((newLines: string[]) => {
    setLines(newLines);
  }, []);

  const handlePhase = useCallback((p: 'running' | 'completed' | 'failed') => {
    if (p === 'completed') {
      setPhase('completed');
    } else if (p === 'failed') {
      setPhase('failed');
    }
  }, []);

  const handleFailed = useCallback((err: string) => {
    setError(err);
    setPhase('failed');
  }, []);

  const handleCompletedNoDraft = useCallback(() => {
    setPhase('completed');
  }, []);

  const handleSessionLost = useCallback(() => {
    setError('Connection lost — the rebuild may still be running in the background.');
    setPhase('failed');
  }, []);

  // Dummy callbacks required by the hook
  const handleDraft = useCallback(() => {
    // Rebuild doesn't produce a draft — we handle completion via status
    setPhase('completed');
  }, []);

  useBackgroundSnapshot({
    snapshotId: rebuildId,
    getSnapshot,
    onLines: handleLines,
    onPhase: handlePhase,
    onDraft: handleDraft,
    onCompletedNoDraft: handleCompletedNoDraft,
    onFailed: handleFailed,
    onSessionLost: handleSessionLost,
    interval: 1500,
  });

  const handleStartRebuild = async () => {
    setPhase('processing');
    setLines([]);
    setError(null);
    try {
      const result = await rebuildDesignReview(
        review.id,
        userDirection.trim() || undefined,
      );
      setRebuildId(result.rebuild_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('failed');
    }
  };

  const handleCancel = async () => {
    if (rebuildId) {
      try {
        await cancelRebuild(rebuildId);
      } catch {
        // Best effort
      }
    }
    setPhase('failed');
    setError('Cancelled by user');
  };

  const handleClose = () => {
    if (phase === 'completed') {
      onCompleted();
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={phase === 'processing' ? undefined : handleClose} />

      <div className="relative w-full max-w-2xl max-h-[80vh] bg-background border border-primary/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b border-primary/10 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <RefreshCw className={`w-4 h-4 text-blue-400 ${phase === 'processing' ? 'animate-spin' : ''}`} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground/90 truncate">
                Rebuild Template
              </h2>
              <p className="text-xs text-muted-foreground/60 truncate">
                {review.test_case_name}
              </p>
            </div>
          </div>
          {phase !== 'processing' && (
            <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors">
              <X className="w-4 h-4 text-muted-foreground/70" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {phase === 'input' && (
            <div className="space-y-4">
              {/* Instruction context */}
              <div className="bg-secondary/30 rounded-xl border border-primary/10 p-4">
                <div className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wide mb-1.5">
                  Template Instruction
                </div>
                <p className="text-sm text-foreground/80 leading-relaxed">
                  {review.instruction}
                </p>
              </div>

              {/* User direction */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground/70 mb-1.5">
                  Custom Direction (optional)
                </label>
                <textarea
                  value={userDirection}
                  onChange={(e) => setUserDirection(e.target.value)}
                  placeholder="Add specific requirements, focus areas, or constraints for this rebuild..."
                  className="w-full h-28 px-4 py-3 bg-secondary/20 border border-primary/10 rounded-xl text-sm text-foreground/90 placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:border-violet-500/30 focus:ring-1 focus:ring-violet-500/20 transition-colors"
                />
                <p className="text-xs text-muted-foreground/40 mt-1">
                  The rebuild will regenerate all 9 data dimensions using the Protocol System.
                </p>
              </div>
            </div>
          )}

          {phase === 'processing' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-blue-400/80">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Rebuilding template with Claude CLI...</span>
              </div>

              {/* Streaming output */}
              <div className="bg-[#0d1117] rounded-xl border border-primary/10 p-4 h-64 overflow-y-auto font-mono text-xs leading-relaxed">
                {lines.length === 0 && (
                  <span className="text-muted-foreground/40">Waiting for output...</span>
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
            </div>
          )}

          {phase === 'completed' && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-4">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </div>
              <h3 className="text-sm font-semibold text-foreground/90 mb-1">
                Rebuild Complete
              </h3>
              <p className="text-xs text-muted-foreground/60 max-w-sm">
                The template has been regenerated with all data dimensions.
                The gallery will refresh to show updated scores.
              </p>
            </div>
          )}

          {phase === 'failed' && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="p-3 rounded-2xl bg-red-500/10 border border-red-500/20 mb-4">
                <XCircle className="w-8 h-8 text-red-400" />
              </div>
              <h3 className="text-sm font-semibold text-foreground/90 mb-1">
                Rebuild Failed
              </h3>
              <p className="text-xs text-muted-foreground/60 max-w-sm">
                {error || 'An unknown error occurred during rebuild.'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-primary/10 flex items-center justify-end gap-3">
          {phase === 'input' && (
            <>
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm rounded-xl text-muted-foreground/70 hover:bg-secondary/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleStartRebuild}
                className="px-4 py-2 text-sm rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Start Rebuild
              </button>
            </>
          )}

          {phase === 'processing' && (
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm rounded-xl text-red-400/70 border border-red-500/20 hover:bg-red-500/10 transition-colors flex items-center gap-2"
            >
              <Square className="w-3 h-3" />
              Cancel Rebuild
            </button>
          )}

          {(phase === 'completed' || phase === 'failed') && (
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm rounded-xl bg-secondary/50 text-foreground/80 hover:bg-secondary/70 transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
