import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Bottom nav — Back on the left, primary action on the right. The primary
 * action flips between "Next" and "Submit all" based on position and
 * completeness. Disabled states mirror the keyboard shortcuts (next only
 * when not at end; submit only when every question is answered and no
 * vault category is blocked).
 */
export function QuestionnaireFooterNav({
  activeIdx,
  isAtEnd,
  canSubmit,
  onPrev,
  onNext,
  onSubmit,
}: {
  activeIdx: number;
  isAtEnd: boolean;
  canSubmit: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex-shrink-0 border-t border-border">
      <div className="flex items-center justify-between px-6 py-3">
        <button
          type="button"
          onClick={onPrev}
          disabled={activeIdx === 0}
          className="flex items-center gap-1.5 text-base text-foreground hover:text-foreground/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
          {t.templates.adopt_modal.previous}
        </button>
        <div className="flex items-center gap-3">
          {isAtEnd && canSubmit ? (
            <button
              type="button"
              onClick={onSubmit}
              className="flex items-center gap-2 px-6 py-2.5 text-base font-medium rounded-modal bg-btn-primary text-white hover:bg-btn-primary/90 shadow-elevation-3 shadow-primary/20 transition-all"
            >
              <Sparkles className="w-5 h-5" />
              {t.templates.adopt_modal.submit_all}
            </button>
          ) : (
            <button
              type="button"
              onClick={onNext}
              disabled={isAtEnd}
              className="flex items-center gap-2 px-5 py-2.5 text-base font-medium rounded-modal bg-btn-primary text-white hover:bg-btn-primary/90 disabled:opacity-40 disabled:cursor-not-allowed shadow-elevation-3 shadow-primary/20 transition-all"
            >
              {t.templates.adopt_modal.next}
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
