import { useRef, useEffect, useState } from 'react';
import { GraduationCap, Clock } from 'lucide-react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import type { CategoryWithCount } from '@/api/overview/reviews';
import { getCategoryMeta } from '../filters/searchConstants';
import { DIFFICULTY_OPTIONS, SETUP_OPTIONS, DIFFICULTY_META, SETUP_META } from '../../../shared/templateComplexity';
import type { QueryChip } from './useStructuredQuery';

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
}

export function SearchAutocomplete({
  prefix,
  query,
  availableCategories,
  activeChips,
  onSelect,
  onDismiss,
}: SearchAutocompleteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(-1);

  // Filter suggestions based on prefix type and query
  const suggestions = (() => {
    if (prefix.startsWith('category')) {
      const activeValues = new Set(activeChips.filter((c) => c.type === 'category').map((c) => c.value));
      return availableCategories
        .filter((cat) => !activeValues.has(cat.name))
        .filter((cat) => {
          if (!query) return true;
          const meta = getCategoryMeta(cat.name);
          return (
            cat.name.toLowerCase().includes(query.toLowerCase()) ||
            meta.label.toLowerCase().includes(query.toLowerCase())
          );
        })
        .slice(0, 10)
        .map((cat) => {
          const meta = getCategoryMeta(cat.name);
          return {
            chip: { type: 'category' as const, value: cat.name, label: meta.label },
            icon: meta.icon,
            color: meta.color,
            count: undefined as number | undefined,
            countNum: cat.count,
          };
        });
    }

    if (prefix.startsWith('difficulty')) {
      const activeValues = new Set(activeChips.filter((c) => c.type === 'difficulty').map((c) => c.value));
      return DIFFICULTY_OPTIONS
        .filter((opt) => !activeValues.has(opt.value))
        .filter((opt) => {
          if (!query) return true;
          return opt.value.includes(query.toLowerCase()) || opt.label.toLowerCase().includes(query.toLowerCase());
        })
        .map((opt) => ({
          chip: { type: 'difficulty' as const, value: opt.value, label: opt.label },
          icon: GraduationCap,
          color: DIFFICULTY_META[opt.value].color,
          count: undefined as number | undefined,
        }));
    }

    if (prefix.startsWith('setup')) {
      const activeValues = new Set(activeChips.filter((c) => c.type === 'setup').map((c) => c.value));
      return SETUP_OPTIONS
        .filter((opt) => !activeValues.has(opt.value))
        .filter((opt) => {
          if (!query) return true;
          return opt.value.includes(query.toLowerCase()) || opt.label.toLowerCase().includes(query.toLowerCase());
        })
        .map((opt) => ({
          chip: { type: 'setup' as const, value: opt.value, label: opt.label },
          icon: Clock,
          color: SETUP_META[opt.value].color,
          count: undefined as number | undefined,
        }));
    }

    return [];
  })();

  // Reset focus when suggestions change
  useEffect(() => {
    setFocusIndex(-1);
  }, [suggestions.length]);

  // Keyboard navigation
  useEffect(() => {
    if (suggestions.length === 0) return;

    const handleKey = (e: KeyboardEvent) => {
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
        e.preventDefault();
        onDismiss();
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [suggestions, focusIndex, onSelect, onDismiss]);

  useClickOutside(containerRef, true, onDismiss);

  if (suggestions.length === 0) return null;

  return (
    <div ref={containerRef} className="absolute top-full left-0 right-0 z-50 mt-1">
      <div
          className="animate-fade-slide-in bg-background border border-primary/15 rounded-xl shadow-lg overflow-hidden"
          role="listbox"
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
                  {suggestion.count !== undefined && (
                    <span className="text-sm text-muted-foreground/50 tabular-nums">{suggestion.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
    </div>
  );
}
