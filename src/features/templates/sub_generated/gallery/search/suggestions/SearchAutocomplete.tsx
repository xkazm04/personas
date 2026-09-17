import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { GraduationCap, Clock, type LucideIcon } from 'lucide-react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import type { CategoryWithCount } from '@/api/overview/reviews';
import { getCategoryMeta } from '../filters/searchConstants';
import { DIFFICULTY_OPTIONS, SETUP_OPTIONS, DIFFICULTY_META, SETUP_META } from '../../../shared/templateComplexity';
import type { QueryChip } from './useStructuredQuery';

type ChipType = QueryChip['type'];
interface SuggestionItem { chip: QueryChip; icon: LucideIcon; color: string }
interface SuggestionGroup { type: ChipType; items: SuggestionItem[] }

/**
 * The empty prefix means BROWSE: every chip group at once, which is what the
 * dropdown shows when the input is focused and empty. Structured filtering
 * used to be reachable only by typing `category:` / `difficulty:` / `setup:`,
 * a DSL no placeholder ever named, so difficulty and setup were power-user
 * syntax rather than facets.
 */
export const BROWSE_PREFIX = '';

function buildSuggestions(
  options: { value: string; label: string; icon: LucideIcon; color: string }[],
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
  /** The recognized prefix being typed (e.g. "category:"), or BROWSE_PREFIX for all groups */
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
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(-1);

  // Filter suggestions based on prefix type and query (memoized to stabilise reference)
  const groups = useMemo<SuggestionGroup[]>(() => {
    const categoryGroup = (): SuggestionGroup => {
      const opts = availableCategories.slice(0, 10).map((cat) => {
        const meta = getCategoryMeta(cat.name);
        return { value: cat.name, label: meta.label, icon: meta.icon, color: meta.color };
      });
      return { type: 'category', items: buildSuggestions(opts, activeChips, 'category', query) };
    };
    const difficultyGroup = (): SuggestionGroup => {
      const opts = DIFFICULTY_OPTIONS.map((o) => ({ ...o, icon: GraduationCap, color: DIFFICULTY_META[o.value].color }));
      return { type: 'difficulty', items: buildSuggestions(opts, activeChips, 'difficulty', query) };
    };
    const setupGroup = (): SuggestionGroup => {
      const opts = SETUP_OPTIONS.map((o) => ({ ...o, icon: Clock, color: SETUP_META[o.value].color }));
      return { type: 'setup', items: buildSuggestions(opts, activeChips, 'setup', query) };
    };

    if (prefix === BROWSE_PREFIX) {
      return [categoryGroup(), difficultyGroup(), setupGroup()].filter((g) => g.items.length > 0);
    }
    if (prefix.startsWith('category')) return [categoryGroup()];
    if (prefix.startsWith('difficulty')) return [difficultyGroup()];
    if (prefix.startsWith('setup')) return [setupGroup()];
    return [];
  }, [prefix, query, availableCategories, activeChips]);

  // Flattened for keyboard navigation: one focus index across every group.
  const suggestions = useMemo(() => groups.flatMap((g) => g.items), [groups]);

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

  const groupLabel = (type: ChipType) =>
    type === 'category' ? t.templates.search.autocomplete_categories
      : type === 'difficulty' ? t.templates.search.autocomplete_difficulty
      : t.templates.search.autocomplete_setup_time;

  let flatIndex = -1;
  return (
    <div ref={containerRef} className="absolute top-full left-0 right-0 z-50 mt-1">
      <div
        className="animate-fade-slide-in bg-background border border-primary/15 rounded-modal shadow-elevation-3 overflow-hidden"
        role="listbox"
        id="search-suggestions-listbox"
        aria-label={t.templates.search.search_suggestions_aria}
      >
        <div className="max-h-64 overflow-y-auto py-1">
          {groups.map((group) => (
            <div key={group.type} role="group" aria-label={groupLabel(group.type)}>
              <div className="px-3 py-1.5 typo-body uppercase tracking-wider text-foreground border-b border-primary/10">
                {groupLabel(group.type)}
              </div>
              {group.items.map((suggestion) => {
                flatIndex += 1;
                const idx = flatIndex;
                const Icon = suggestion.icon;
                const isFocused = focusIndex === idx;
                return (
                  <button
                    key={`${suggestion.chip.type}-${suggestion.chip.value}`}
                    id={`search-suggestion-${idx}`}
                    role="option"
                    aria-selected={isFocused}
                    type="button"
                    onClick={() => onSelect(suggestion.chip)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 typo-body transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-card outline-none ${
                      isFocused
                        ? 'bg-violet-500/10 text-foreground/90'
                        : 'text-foreground hover:bg-primary/5'
                    }`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" style={{ color: suggestion.color }} />
                    <span className="flex-1 text-left">{suggestion.chip.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
