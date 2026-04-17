import { useState, useRef, useEffect } from 'react';
import { RefreshCw, X, CheckCircle2, XCircle, Square } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
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
  const { t } = useTranslation();
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
      panelClassName="max-h-[80vh] bg-background border border-primary/15 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden"
    >
        {/* Header */}
        <div className="px-6 py-4 border-b border-primary/10 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-modal bg-blue-500/10 border border-blue-500/20">
              <RefreshCw className={`w-4 h-4 text-blue-400 ${displayPhase === 'processing' ? 'animate-spin' : ''}`} />
            </div>
            <div className="min-w-0">
              <h2 id="rebuild-modal-title" className="typo-heading font-semibold text-foreground/90 truncate">
                {t.templates.rebuild_modal.title}
              </h2>
              <p className="typo-body text-foreground truncate">
                {review.test_case_name}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-card hover:bg-secondary/50 transition-colors">
            <X className="w-4 h-4 text-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {displayPhase === 'input' && (
            <div className="space-y-4">
              {/* Instruction context */}
              <div className="bg-secondary/30 rounded-modal border border-primary/10 p-4">
                <div className="typo-body font-medium text-foreground uppercase tracking-wide mb-1.5">
                  {t.templates.rebuild_modal.template_instruction}
                </div>
                <p className="typo-body text-foreground leading-relaxed">
                  {review.instruction}
                </p>
              </div>

              {/* User direction */}
              <div>
                <label className="block typo-body font-medium text-foreground mb-1.5">
                  {t.templates.rebuild_modal.custom_direction}
                </label>
                <textarea
                  value={userDirection}
                  onChange={(e) => setUserDirection(e.target.value)}
                  placeholder={t.templates.rebuild_modal.custom_direction_placeholder}
                  className="w-full h-28 px-4 py-3 bg-secondary/20 border border-primary/10 rounded-modal typo-body text-foreground/90 placeholder:text-foreground resize-none focus-visible:outline-none focus-visible:border-violet-500/30 focus-visible:ring-1 focus-visible:ring-violet-500/20 transition-colors"
                />
                <p className="typo-body text-foreground mt-1">
                  {t.templates.rebuild_modal.custom_direction_hint}
                </p>
              </div>
            </div>
          )}

          {displayPhase === 'processing' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 typo-body text-blue-400/80">
                <LoadingSpinner size="sm" />
                <span>{t.templates.rebuild_modal.rebuilding_with_cli}</span>
              </div>

              {/* Streaming output */}
              <div className="bg-[#0d1117] rounded-modal border border-primary/10 p-4 h-64 overflow-y-auto font-mono typo-code leading-relaxed">
                {lines.length === 0 && (
                  <span className="text-foreground">{t.templates.rebuild_modal.waiting_for_output}</span>
                )}
                {lines.map((line, i) => {
                  const isMilestone = line.startsWith('[Milestone]');
                  return (
                    <div
                      key={i}
                      className={
                        isMilestone
                          ? 'text-blue-400/80 font-semibold mt-2 first:mt-0'
                          : 'text-foreground'
                      }
                    >
                      {line}
                    </div>
                  );
                })}
                <div ref={linesEndRef} />
              </div>

              <p className="typo-body text-foreground text-center">
                {t.templates.rebuild_modal.close_continues_bg}
              </p>
            </div>
          )}

          {displayPhase === 'completed' && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="p-3 rounded-modal bg-emerald-500/10 border border-emerald-500/20 mb-4">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </div>
              <h3 className="typo-heading font-semibold text-foreground/90 mb-1">
                {t.templates.rebuild_modal.rebuild_complete}
              </h3>
              <p className="typo-body text-foreground max-w-sm">
                {t.templates.rebuild_modal.rebuild_complete_hint}
              </p>
            </div>
          )}

          {displayPhase === 'failed' && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="p-3 rounded-modal bg-red-500/10 border border-red-500/20 mb-4">
                <XCircle className="w-8 h-8 text-red-400" />
              </div>
              <h3 className="typo-heading font-semibold text-foreground/90 mb-1">
                {t.templates.rebuild_modal.rebuild_failed}
              </h3>
              <p className="typo-body text-foreground max-w-sm">
                {error || t.templates.rebuild_modal.unknown_error}
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
                className="px-4 py-2 typo-body rounded-modal text-foreground hover:bg-secondary/50 transition-colors"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={() => onStartRebuild(userDirection)}
                className="px-4 py-2 typo-body rounded-modal bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {t.templates.rebuild_modal.start_rebuild}
              </button>
            </>
          )}

          {displayPhase === 'processing' && (
            <div className="flex items-center gap-2">
              <button
                onClick={onCancel}
                className="px-4 py-2 typo-body rounded-modal text-red-400/70 border border-red-500/20 hover:bg-red-500/10 transition-colors flex items-center gap-2"
              >
                <Square className="w-3 h-3" />
                {t.templates.rebuild_modal.cancel_rebuild}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 typo-body rounded-modal bg-secondary/50 text-foreground hover:bg-secondary/70 transition-colors"
              >
                {t.templates.rebuild_modal.run_in_background}
              </button>
            </div>
          )}

          {(displayPhase === 'completed' || displayPhase === 'failed') && (
            <button
              onClick={onClose}
              className="px-4 py-2 typo-body rounded-modal bg-secondary/50 text-foreground hover:bg-secondary/70 transition-colors"
            >
              {t.common.close}
            </button>
          )}
        </div>
    </BaseModal>
  );
}
