import { GitCompare, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import Button from '@/features/shared/components/buttons/Button';

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
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-3 py-2 rounded-modal glass-md border border-hair shadow-elevation-3 max-w-[90%]">
      <span className="typo-body text-foreground whitespace-nowrap">
        {tx(t.templates.compare.selected, { count: selected.length })}
      </span>

      <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto">
        {selected.map((s) => (
          <span
            key={s.id}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-input bg-surface-2 border border-hair max-w-[160px]"
          >
            <span className="typo-caption text-foreground truncate">{s.test_case_name}</span>
            <Button
              type="button"
              onClick={() => onRemove(s.id)}
              aria-label={t.templates.compare.remove_from_compare}
              variant="ghost"
              size="icon-sm"
            >
              <X className="w-3 h-3" />
            </Button>
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {!canCompare && (
          <span className="typo-caption text-foreground whitespace-nowrap">{t.templates.compare.hint_min}</span>
        )}
        <Button
          type="button"
          onClick={onCompare}
          disabled={!canCompare}
          variant="primary"
          size="sm"
          icon={<GitCompare className="w-3.5 h-3.5" />}
        >
          {t.templates.compare.compare}
        </Button>
        <Button
          type="button"
          onClick={onClear}
          variant="ghost"
          size="sm"
        >
          {t.templates.compare.clear}
        </Button>
      </div>
    </div>
  );
}
