import { useState, useRef, useEffect } from 'react';
import { RefreshCw, X, CheckCircle2, XCircle, Square } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { RebuildPhase } from '@/hooks/design/core/useBackgroundRebuild';
import type { DimensionKey } from '../../shared/DimensionRadial';
import { getCachedDesignResult } from '../cards/reviewParseCache';
import { BaseModal } from '../../shared/BaseModal';
import { RebuildDimensionTargets } from './RebuildDimensionTargets';

interface RebuildModalProps {
  isOpen: boolean;
  onClose: () => void;
  review: PersonaDesignReview | null;
  /** Externally managed rebuild state */
  phase: RebuildPhase;
  lines: string[];
  error: string | null;
  /** `regenTargets` are the design dimensions the reviewer flagged; empty
   *  means "rebuild the whole entry", which is the behaviour this modal had
   *  before the flags existed. */
  onStartRebuild: (userDirection?: string, regenTargets?: DimensionKey[]) => void;
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
  const [regenTargets, setRegenTargets] = useState<Set<DimensionKey>>(() => new Set());
  const linesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    linesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  // Reset user direction when modal opens with a new review
  useEffect(() => {
    if (isOpen) {
      setUserDirection('');
      setRegenTargets(new Set());
    }
  }, [isOpen, review?.id]);

  const toggleTarget = (dim: DimensionKey) => {
    setRegenTargets((prev) => {
      const next = new Set(prev);
      if (next.has(dim)) next.delete(dim);
      else next.add(dim);
      return next;
    });
  };

  // Determine display phase: if hook phase is idle/input, show input form
  const displayPhase = phase === 'idle' ? 'input' : phase;

  if (!isOpen || !review) return null;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="rebuild-modal-title"
      maxWidthClass="max-w-2xl"
      panelClassName="max-h-[80vh] bg-background border border-hair rounded-card shadow-elevation-4 flex flex-col overflow-hidden"
    >
        {/* Header */}
        <div className="px-6 py-4 border-b border-hair flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-modal bg-status-info/10 border border-status-info/20">
              <RefreshCw className={`w-4 h-4 text-status-info ${displayPhase === 'processing' ? 'animate-spin' : ''}`} />
            </div>
            <div className="min-w-0">
              <h2 id="rebuild-modal-title" className="typo-heading text-ink-1 truncate">
                {t.templates.rebuild_modal.title}
              </h2>
              <p className="typo-body text-foreground truncate">
                {review.test_case_name}
              </p>
            </div>
          </div>
          <Button onClick={onClose} variant="ghost" size="icon-sm" aria-label={t.common.close}>
            <X className="w-4 h-4 text-foreground" aria-hidden="true" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {displayPhase === 'input' && (
            <div className="space-y-4">
              {/* Instruction context */}
              <div className="bg-surface-1 rounded-modal border border-hair p-4">
                <div className="typo-eyebrow text-foreground mb-1.5">
                  {t.templates.rebuild_modal.template_instruction}
                </div>
                <p className="typo-body text-foreground">
                  {review.instruction}
                </p>
              </div>

              {/* User direction */}
              <div>
                <label className="block typo-body text-foreground mb-1.5">
                  {t.templates.rebuild_modal.custom_direction}
                </label>
                <textarea
                  value={userDirection}
                  onChange={(e) => setUserDirection(e.target.value)}
                  placeholder={t.templates.rebuild_modal.custom_direction_placeholder}
                  className="w-full h-28 px-4 py-3 bg-surface-1 border border-hair rounded-modal typo-body text-ink-1 placeholder:text-foreground resize-none focus-visible:outline-none focus-visible:border-role-agent/30 focus-visible:ring-1 focus-visible:ring-role-agent/20 transition-colors"
                />
                <p className="typo-body text-foreground mt-1">
                  {t.templates.rebuild_modal.custom_direction_hint}
                </p>
              </div>

              <RebuildDimensionTargets
                designResult={getCachedDesignResult(review)}
                selected={regenTargets}
                onToggle={toggleTarget}
              />
            </div>
          )}

          {displayPhase === 'processing' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 typo-body text-status-info/80">
                <LoadingSpinner size="sm" />
                <span>{t.templates.rebuild_modal.rebuilding_with_cli}</span>
              </div>

              {/* Streaming output */}
              <div className="bg-[#0d1117] rounded-modal border border-hair p-4 h-64 overflow-y-auto typo-code">
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
                          ? 'text-status-info/80 font-semibold mt-2 first:mt-0'
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
              <div className="p-3 rounded-modal bg-surface-1 border border-hair mb-4">
                <CheckCircle2 className="w-8 h-8 text-status-success" />
              </div>
              <h3 className="typo-heading text-ink-1 mb-1">
                {t.templates.rebuild_modal.rebuild_complete}
              </h3>
              <p className="typo-body text-foreground max-w-sm">
                {t.templates.rebuild_modal.rebuild_complete_hint}
              </p>
            </div>
          )}

          {displayPhase === 'failed' && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="p-3 rounded-modal bg-status-error/10 border border-status-error/20 mb-4">
                <XCircle className="w-8 h-8 text-status-error" />
              </div>
              <h3 className="typo-heading text-ink-1 mb-1">
                {t.templates.rebuild_modal.rebuild_failed}
              </h3>
              <p className="typo-body text-foreground max-w-sm">
                {error || t.templates.rebuild_modal.unknown_error}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-hair flex items-center justify-end gap-3">
          {displayPhase === 'input' && (
            <>
              <Button
                type="button"
                onClick={onClose}
                variant="ghost"
                size="md"
              >
                {t.common.cancel}
              </Button>
              <Button
                type="button"
                onClick={() => onStartRebuild(userDirection, [...regenTargets])}
                variant="accent"
                tone="agent"
                size="md"
                icon={<RefreshCw className="w-3.5 h-3.5" />}
              >
                {t.templates.rebuild_modal.start_rebuild}
              </Button>
            </>
          )}

          {displayPhase === 'processing' && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={onCancel}
                variant="danger"
                size="md"
                icon={<Square className="w-3 h-3" />}
              >
                {t.templates.rebuild_modal.cancel_rebuild}
              </Button>
              <Button
                type="button"
                onClick={onClose}
                variant="ghost"
                size="md"
              >
                {t.templates.rebuild_modal.run_in_background}
              </Button>
            </div>
          )}

          {(displayPhase === 'completed' || displayPhase === 'failed') && (
            <Button
              type="button"
              onClick={onClose}
              variant="ghost"
              size="md"
            >
              {t.common.close}
            </Button>
          )}
        </div>
    </BaseModal>
  );
}
