import { GitCompare, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { BUTTON_VARIANTS } from '@/lib/utils/designTokens';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

interface CompareTrayProps {
  selected: PersonaDesignReview[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onCompare: () => void;
}

/**
 * Floating bottom-center tray that surfaces the current compare selection.
 * Renders nothing when empty; the Compare action enables once 2+ are picked.
 */
export function CompareTray({ selected, onRemove, onClear, onCompare }: CompareTrayProps) {
  const { t, tx } = useTranslation();
  if (selected.length === 0) return null;
  const canCompare = selected.length >= 2;

  return (
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-3 py-2 rounded-modal glass-md border border-primary/15 shadow-elevation-3 max-w-[90%]">
      <span className="typo-body font-medium text-foreground whitespace-nowrap">
        {tx(t.templates.compare.selected, { count: selected.length })}
      </span>

      <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto">
        {selected.map((s) => (
          <span
            key={s.id}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-input bg-secondary/50 border border-primary/10 max-w-[160px]"
          >
            <span className="typo-caption text-foreground truncate">{s.test_case_name}</span>
            <button
              onClick={() => onRemove(s.id)}
              aria-label={t.templates.compare.remove_from_compare}
              className="p-0.5 rounded text-foreground hover:bg-secondary/60 transition-colors flex-shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {!canCompare && (
          <span className="typo-caption text-foreground whitespace-nowrap">{t.templates.compare.hint_min}</span>
        )}
        <button
          onClick={onCompare}
          disabled={!canCompare}
          className={`px-3 py-1.5 typo-body rounded-modal border transition-colors inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${BUTTON_VARIANTS.adopt.bg} ${BUTTON_VARIANTS.adopt.text} ${BUTTON_VARIANTS.adopt.border} ${BUTTON_VARIANTS.adopt.hover}`}
        >
          <GitCompare className="w-3.5 h-3.5" />
          {t.templates.compare.compare}
        </button>
        <button
          onClick={onClear}
          className="px-2.5 py-1.5 typo-body rounded-modal text-foreground hover:bg-secondary/50 transition-colors"
        >
          {t.templates.compare.clear}
        </button>
      </div>
    </div>
  );
}
