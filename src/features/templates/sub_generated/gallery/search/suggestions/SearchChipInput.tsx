import { memo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Search, X, Send, GraduationCap, Clock } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { SearchAutocomplete } from './SearchAutocomplete';
import { getCategoryMeta } from '../filters/searchConstants';
import { DIFFICULTY_META, SETUP_META } from '../../../shared/templateComplexity';
import type { DifficultyLevel, SetupLevel } from '../../../shared/templateComplexity';
import type { CategoryWithCount } from '@/api/overview/reviews';
import type { QueryChip } from './useStructuredQuery';

interface SearchChipInputProps {
  chips: QueryChip[];
  inputValue: string;
  setInputValue: (v: string) => void;
  removeChip: (i: number) => void;
  addChip: (chip: QueryChip) => void;
  clearAll: () => void;
  autocompletePrefix: string | null;
  autocompleteQuery: string;
  aiSearchMode?: boolean;
  aiSearchLoading?: boolean;
  onAiSearchSubmit?: (query: string) => void;
  availableCategories: CategoryWithCount[];
}

function SearchChipInputImpl({
  chips, inputValue, setInputValue, removeChip, addChip, clearAll,
  autocompletePrefix, autocompleteQuery,
  aiSearchMode, aiSearchLoading, onAiSearchSubmit, availableCategories,
}: SearchChipInputProps) {
  const { t } = useTranslation();
  const [activeDescendant, setActiveDescendant] = useState<string | undefined>(undefined);
  const showAutocomplete = !!autocompletePrefix && !aiSearchMode;

  return (
    <div className={`relative flex-1 min-w-0 flex items-center flex-wrap gap-1 bg-secondary/40 border rounded-modal transition-all ${
      aiSearchMode
        ? 'border-indigo-500/20 focus-within:border-indigo-500/40 focus-within:ring-1 focus-within:ring-indigo-500/20'
        : 'border-primary/10 focus-within:border-violet-500/30 focus-within:ring-1 focus-within:ring-violet-500/20'
    }`}>
      <div className="pl-3 flex-shrink-0">
        {aiSearchMode && aiSearchLoading
          ? <LoadingSpinner className="text-indigo-400" />
          : <Search className="w-4 h-4 text-foreground" />}
      </div>

      {chips.map((chip, i) => {
        let Icon: typeof Search | null = null;
        let chipColor: string | undefined;
        let chipBg = 'bg-violet-500/10 border-violet-500/20 text-violet-300';

        if (chip.type === 'category') {
          const meta = getCategoryMeta(chip.value);
          Icon = meta.icon;
          chipColor = meta.color;
        } else if (chip.type === 'difficulty') {
          Icon = GraduationCap;
          const dm = DIFFICULTY_META[chip.value as DifficultyLevel];
          chipColor = dm?.color;
          chipBg = dm ? `${dm.bgClass}` : chipBg;
        } else if (chip.type === 'setup') {
          Icon = Clock;
          const sm = SETUP_META[chip.value as SetupLevel];
          chipColor = sm?.color;
          chipBg = sm ? `${sm.bgClass}` : chipBg;
        }

        return (
          <span key={`${chip.type}-${chip.value}`}
            className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 typo-body rounded-full border flex-shrink-0 ${chipBg}`}>
            {Icon && <Icon className="w-3 h-3" style={{ color: chipColor }} />}
            {chip.label}
            <button onClick={() => removeChip(i)}
              aria-label={`Remove ${chip.label} filter`}
              className="ml-0.5 p-0.5 hover:text-white transition-colors rounded-full hover:bg-white/10">
              <X className="w-2.5 h-2.5" aria-hidden="true" />
            </button>
          </span>
        );
      })}

      <input
        data-testid="template-search-input"
        type="text" value={inputValue}
        role="combobox"
        aria-expanded={showAutocomplete}
        aria-controls={showAutocomplete ? "search-suggestions-listbox" : undefined}
        aria-autocomplete="list"
        aria-activedescendant={showAutocomplete ? activeDescendant : undefined}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && aiSearchMode && onAiSearchSubmit && inputValue.trim()) {
            e.preventDefault();
            onAiSearchSubmit(inputValue.trim());
          }
          if (e.key === 'Backspace' && !inputValue && chips.length > 0) {
            removeChip(chips.length - 1);
          }
        }}
        placeholder={
          chips.length > 0 ? t.templates.search.placeholder_add_more
            : aiSearchMode ? t.templates.search.placeholder_ai
            : t.templates.search.placeholder_default
        }
        className="flex-1 min-w-[120px] py-2 pr-10 typo-body bg-transparent text-foreground/90 placeholder:text-foreground focus-visible:outline-none"
      />

      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
        {aiSearchMode ? (
          <>
            {inputValue && (
              <button onClick={clearAll} aria-label="Clear search" className="p-1 text-foreground hover:text-foreground/70">
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
            <button onClick={() => onAiSearchSubmit?.(inputValue.trim())}
              disabled={!inputValue.trim() || aiSearchLoading}
              className="p-1.5 rounded-card bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              aria-label="Search with AI">
              {aiSearchLoading ? <LoadingSpinner size="sm" /> : <Send className="w-3.5 h-3.5" aria-hidden="true" />}
            </button>
          </>
        ) : (
          (inputValue || chips.length > 0) && (
            <button onClick={clearAll} aria-label="Clear search" className="p-1 text-foreground hover:text-foreground/70">
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )
        )}
      </div>

      {showAutocomplete && (
        <SearchAutocomplete
          prefix={autocompletePrefix!} query={autocompleteQuery}
          availableCategories={availableCategories} activeChips={chips}
          onSelect={(chip) => addChip(chip)}
          onDismiss={() => {
            setActiveDescendant(undefined);
            const words = inputValue.split(/\s+/);
            setInputValue(words.slice(0, -1).join(' '));
          }}
          onFocusChange={setActiveDescendant}
        />
      )}
    </div>
  );
}

/**
 * Memoized export — prevents re-renders when only upstream gallery data changes
 * (e.g. items array updating after debounce) while this component's own props
 * remain stable. Critical for keeping input focus across fetch cycles.
 */
export const SearchChipInput = memo(SearchChipInputImpl);
