import { Sparkles } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import type { NoteSuggestion } from '../variants/types';

interface SuggestionSlotProps {
  suggestions: NoteSuggestion[];
  className?: string;
  /** Hide the "no suggestions" line — for a margin rail where an empty state
   *  would be noise rather than information. */
  quietWhenEmpty?: boolean;
}

/**
 * Where Athena's suggestions land.
 *
 * PLACEHOLDER, deliberately: WP3 owns the `note_suggestions` card and the
 * accept/reject/edit resolution. What ships here is the SLOT — every variant
 * already reserves the right space for it, so wiring the real rows later is a
 * change inside this one file rather than three layout rewrites.
 */
export function SuggestionSlot({ suggestions, className, quietWhenEmpty }: SuggestionSlotProps) {
  const { t } = useTranslation();

  if (suggestions.length === 0) {
    if (quietWhenEmpty) return null;
    return (
      <div className={`typo-caption text-foreground/50 ${className ?? ''}`}>
        {t.notepad.suggestions_empty}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      <div className="flex items-center gap-1.5 typo-caption text-foreground/60">
        <Sparkles className="w-3 h-3" aria-hidden />
        {t.notepad.suggestions_title}
      </div>
      {suggestions.map((s) => (
        <div
          key={s.rowId}
          className="rounded-card border border-primary/15 bg-secondary/20 px-3 py-2 typo-caption text-foreground/80"
        >
          {s.title ?? s.bodyMd.slice(0, 120)}
        </div>
      ))}
    </div>
  );
}
