import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { GraduationCap, Clock } from 'lucide-react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import type { CategoryWithCount } from '@/api/overview/reviews';
import { getCategoryMeta } from '../filters/searchConstants';
import { DIFFICULTY_OPTIONS, SETUP_OPTIONS, DIFFICULTY_META, SETUP_META } from '../../../shared/templateComplexity';
import type { QueryChip } from './useStructuredQuery';

type ChipType = QueryChip['type'];
interface SuggestionItem { chip: QueryChip; icon: React.ElementType; color: string }

function buildSuggestions(
  options: { value: string; label: string; icon: React.ElementType; color: string }[],
  activeChips: QueryChip[],
  chipType: ChipType,
  query: string,
): SuggestionItem[] {
  const activeValues = new Set(activeChips.filter((c) => c.type === chipType).map((c) => c.value));
  const q = query.toLowerCase();
  return options
    .filter((o) => !activeValues.has(o.value))
    .filter((o) => !q || o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q))
    .map((o) => ({
      chip: { type: chipType, value: o.value, label: o.label },
      icon: o.icon,
      color: o.color,
    }));
}

interface SearchAutocompleteProps {
  /** The recognized prefix being typed (e.g. "category:") */
  prefix: string;
  /** Partial value after the prefix for filtering */
  query: string;
  /** Available categories with counts */
  availableCategories: CategoryWithCount[];
  /** Already-selected chips (to exclude from suggestions) */
  activeChips: QueryChip[];
  /** Called when a suggestion is selected */
  onSelect: (chip: QueryChip) => void;
  /** Called to dismiss the dropdown */
  onDismiss: () => void;
  /** Reports the focused option ID for aria-activedescendant on the input */
  onFocusChange?: (optionId: string | undefined) => void;
}

export function SearchAutocomplete({
  prefix,
  query,
  availableCategories,
  activeChips,
  onSelect,
  onDismiss,
  onFocusChange,
}: SearchAutocompleteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(-1);

  // Filter suggestions based on prefix type and query (memoized to stabilise reference)
  const suggestions = useMemo(() => {
    if (prefix.startsWith('category')) {
      const opts = availableCategories.slice(0, 10).map((cat) => {
        const meta = getCategoryMeta(cat.name);
        return { value: cat.name, label: meta.label, icon: meta.icon, color: meta.color };
      });
      return buildSuggestions(opts, activeChips, 'category', query);
    }

    if (prefix.startsWith('difficulty')) {
      const opts = DIFFICULTY_OPTIONS.map((o) => ({ ...o, icon: GraduationCap, color: DIFFICULTY_META[o.value].color }));
      return buildSuggestions(opts, activeChips, 'difficulty', query);
    }

    if (prefix.startsWith('setup')) {
      const opts = SETUP_OPTIONS.map((o) => ({ ...o, icon: Clock, color: SETUP_META[o.value].color }));
      return buildSuggestions(opts, activeChips, 'setup', query);
    }

    return [];
  }, [prefix, query, availableCategories, activeChips]);

  // Reset focus when suggestions change
  useEffect(() => {
    setFocusIndex(-1);
  }, [suggestions.length]);

  // Keyboard navigation – scoped to events originating within the parent search wrapper
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      const wrapper = containerRef.current?.parentElement;
      if (!wrapper || !wrapper.contains(e.target as Node)) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIndex((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && focusIndex >= 0) {
        e.preventDefault();
        const suggestion = suggestions[focusIndex];
        if (suggestion) onSelect(suggestion.chip);
      } else if (e.key === 'Escape') {
        onDismiss();
      }
    },
    [suggestions, focusIndex, onSelect, onDismiss],
  );

  useEffect(() => {
    if (suggestions.length === 0) return;
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [suggestions.length, handleKey]);

  useClickOutside(containerRef, true, onDismiss);

  // Report focused option ID to parent for aria-activedescendant
  useEffect(() => {
    onFocusChange?.(focusIndex >= 0 ? `search-suggestion-${focusIndex}` : undefined);
  }, [focusIndex, onFocusChange]);

  if (suggestions.length === 0) return null;

  return (
    <div ref={containerRef} className="absolute top-full left-0 right-0 z-50 mt-1">
      <div
          className="animate-fade-slide-in bg-background border border-primary/15 rounded-xl shadow-elevation-3 overflow-hidden"
          role="listbox"
          id="search-suggestions-listbox"
          aria-label="Search suggestions"
        >
          <div className="px-3 py-1.5 text-sm uppercase tracking-wider text-muted-foreground/50 border-b border-primary/10">
            {prefix.startsWith('category') ? 'Categories'
              : prefix.startsWith('difficulty') ? 'Difficulty'
              : prefix.startsWith('setup') ? 'Setup Time'
              : 'Suggestions'}
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {suggestions.map((suggestion, idx) => {
              const Icon = suggestion.icon;
              const isFocused = focusIndex === idx;
              return (
                <button
                  key={suggestion.chip.value}
                  id={`search-suggestion-${idx}`}
                  role="option"
                  aria-selected={isFocused}
                  onClick={() => onSelect(suggestion.chip)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                    isFocused
                      ? 'bg-violet-500/10 text-foreground/90'
                      : 'text-foreground/80 hover:bg-primary/5'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" style={{ color: suggestion.color }} />
                  <span className="flex-1 text-left">{suggestion.chip.label}</span>
                </button>
              );
            })}
          </div>
        </div>
    </div>
  );
}
