import { useCallback, useMemo, useState } from 'react';
import {
  Search, Sparkles, AlertTriangle, Lock, Check, ChevronDown,
} from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { NoResults } from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useDebounce } from '@/hooks/utility/timing/useDebounce';
import { useAgentStore } from '@/stores/agentStore';
import { useSelectedUseCases } from '@/stores/selectors/personaSelectors';
import { useTranslation } from '@/i18n/useTranslation';
import type { Recipe, RecipeCategory } from '../types';
import { useRecipeEligibilityMap } from '../useEligibility';
import { getCategoryLabels } from '../libs/categoryLabels';
import { computeStaleRecipeIds } from '../libs/recipeStaleness';
import { RecipesTableResults } from './RecipesTableResults';

interface RecipesBrowseListProps {
  recipes: Recipe[];
  /** Search is owned by RecipesPage so detail-view tag clicks can land
   *  back in browse with the filter pre-applied. */
  search: string;
  onSearchChange: (value: string) => void;
  onOpenDetail: (recipeId: string) => void;
  /** True while the first `list_recipes` is in flight. Only used to hold the
   *  empty state back — see the results block. */
  isLoading?: boolean;
}

interface CategoryOption {
  value: RecipeCategory | 'all';
  label: string;
}

type EligibilityFilter = 'all' | 'eligible' | 'adoptable-with-setup' | 'incompatible';

/**
 * Browse view — header + filter row + table results.
 *
 * Filters:
 *   - Search box (matches name, summary, description, tags)
 *   - Category dropdown (Listbox) — chosen over chip-row layout because
 *     the catalog will grow past what fits as inline chips. Dropdown
 *     scales linearly to 50+ categories; chip rows fall apart at ~10.
 *   - Eligibility chip row — only shown when a persona is selected.
 *     Otherwise eligibility is a moot dimension and we drop the row
 *     entirely (no banner — recipe.detail surfaces "select a persona"
 *     guidance contextually if a user tries to adopt).
 *
 * Scale note: the catalog is fetched whole into `pipelineStore` and is
 * expected to pass 1000 entries. Two things keep filtering off the typing
 * path at that size — a prebuilt lowercase haystack per recipe (built once
 * per catalog change, not once per keystroke) and a debounce between the
 * input and the filter pass. Row rendering is bounded separately, by the
 * paging inside `RecipesTableResults`.
 */
export function RecipesBrowseList({ recipes, search, onSearchChange, onOpenDetail, isLoading }: RecipesBrowseListProps) {
  const { t } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const eligibilityMap = useRecipeEligibilityMap(recipes);
  const selectedUseCases = useSelectedUseCases();
  const adoptedRecipeIds = useMemo(
    () => new Set(selectedUseCases.map((uc) => uc.source_recipe_id).filter((id): id is string => !!id)),
    [selectedUseCases],
  );
  const staleRecipeIds = useMemo(
    () => computeStaleRecipeIds(recipes, selectedUseCases),
    [recipes, selectedUseCases],
  );

  const [category, setCategory] = useState<RecipeCategory | 'all'>('all');
  const [eligibilityFilter, setEligibilityFilter] = useState<EligibilityFilter>('all');

  // The input stays instant (it renders `search`); only the filter pass waits.
  // Without this every keystroke re-scans the whole catalog and re-renders the
  // table — at 1000 recipes that is what turns typing into a slideshow.
  const debouncedSearch = useDebounce(search, 150);

  // Prebuilt lowercase haystack per recipe. The previous inline
  // `[name, summary, description, ...tags].join(' ').toLowerCase()` allocated
  // two strings per recipe *per keystroke*; this allocates them once per
  // catalog change and the keystroke path becomes a map lookup + `includes`.
  const searchIndex = useMemo(() => {
    const index = new Map<string, string>();
    for (const r of recipes) {
      index.set(r.id, `${r.name} ${r.summary} ${r.description} ${r.tags.join(' ')}`.toLowerCase());
    }
    return index;
  }, [recipes]);

  const categoryOptions = useMemo<CategoryOption[]>(() => {
    const labels = getCategoryLabels(t);
    const counts = new Map<RecipeCategory, number>();
    for (const r of recipes) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    // Buckets with no recipes are hidden rather than offered as dead filters.
    return [
      { value: 'all', label: `${t.recipes_catalog.category_all} (${recipes.length})` },
      ...(Object.keys(labels) as RecipeCategory[])
        .filter((c) => (counts.get(c) ?? 0) > 0)
        .map((c) => ({
          value: c,
          label: `${labels[c]} (${counts.get(c)})`,
        })),
    ];
  }, [t, recipes]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    // Nothing narrows the list — hand back the same array reference so the
    // table's "the list changed, reset paging" effect doesn't fire on every
    // unrelated parent render.
    if (!q && category === 'all' && (!selectedPersona || eligibilityFilter === 'all')) return recipes;
    return recipes.filter((r) => {
      if (category !== 'all' && r.category !== category) return false;
      if (selectedPersona && eligibilityFilter !== 'all') {
        const e = eligibilityMap.get(r.id);
        if (!e || e.state !== eligibilityFilter) return false;
      }
      if (q && !(searchIndex.get(r.id) ?? '').includes(q)) return false;
      return true;
    });
  }, [recipes, debouncedSearch, searchIndex, category, eligibilityFilter, eligibilityMap, selectedPersona]);

  const resetFilters = useCallback(() => {
    onSearchChange('');
    setCategory('all');
    setEligibilityFilter('all');
  }, [onSearchChange]);

  const counts = useMemo(() => {
    let eligible = 0, setup = 0, locked = 0;
    for (const r of recipes) {
      const e = eligibilityMap.get(r.id);
      if (!e) continue;
      if (e.state === 'eligible') eligible++;
      else if (e.state === 'adoptable-with-setup') setup++;
      else locked++;
    }
    return { eligible, setup, locked };
  }, [recipes, eligibilityMap]);

  return (
    <div className="flex flex-col h-full">
      {/* Header band */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-card-border/60 flex-shrink-0">
        <span
          className="flex items-center justify-center rounded-card shrink-0"
          style={{
            width: 36, height: 36,
            background: 'rgba(96,165,250,0.15)',
            border: '1px solid rgba(96,165,250,0.35)',
          }}
        >
          <Sparkles className="w-4 h-4 text-primary" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="typo-section-title text-foreground">{t.recipes_catalog.page_title}</div>
          <div className="typo-caption text-foreground">
            {t.recipes_catalog.page_subtitle}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="typo-data font-mono text-foreground">{recipes.length}</div>
          <div className="typo-label text-foreground">{t.recipes_catalog.available_label}</div>
        </div>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-card-border/40 flex-shrink-0 flex-wrap">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground pointer-events-none" />
          <input
            type="search"
            data-testid="recipes-search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t.recipes_catalog.search_placeholder}
            className="pl-8 pr-3 py-1.5 rounded-input border border-card-border bg-secondary/40 typo-caption text-foreground placeholder:text-foreground/45 focus:outline-none focus:border-primary/45 transition-colors min-w-[220px]"
          />
        </div>

        {/* Category dropdown */}
        <CategoryDropdown value={category} onChange={setCategory} categoryOptions={categoryOptions} />

        {/* Eligibility chips — only when persona selected */}
        {selectedPersona && (
          <div className="flex items-center gap-1 flex-wrap ml-auto">
            <EligibilityFilterChip
              active={eligibilityFilter === 'all'}
              onClick={() => setEligibilityFilter('all')}
              label={t.recipes_catalog.eligibility_all_label}
            />
            <EligibilityFilterChip
              active={eligibilityFilter === 'eligible'}
              onClick={() => setEligibilityFilter('eligible')}
              label={t.recipes_catalog.eligibility_ready_label}
              count={counts.eligible}
              icon={<Check className="w-3 h-3" />}
              tone="success"
            />
            <EligibilityFilterChip
              active={eligibilityFilter === 'adoptable-with-setup'}
              onClick={() => setEligibilityFilter('adoptable-with-setup')}
              label={t.recipes_catalog.eligibility_setup_label}
              count={counts.setup}
              icon={<AlertTriangle className="w-3 h-3" />}
              tone="warning"
            />
            <EligibilityFilterChip
              active={eligibilityFilter === 'incompatible'}
              onClick={() => setEligibilityFilter('incompatible')}
              label={t.recipes_catalog.eligibility_locked_label}
              count={counts.locked}
              icon={<Lock className="w-3 h-3" />}
              tone="muted"
            />
          </div>
        )}
      </div>

      {/* Results. The table owns its own scroller (that is what makes its
          sticky header and infinite scroll work), so this wrapper only gives
          it a bounded height — it must NOT scroll itself. */}
      <div className="flex-1 min-h-0 p-4">
        {filtered.length === 0 ? (
          // Empty-flash-safe (docs/design/overview-loading.md, law 2): "no
          // recipes match" is a claim about a catalog that has arrived. Until
          // the first fetch settles the surface stays quiet rather than
          // asserting emptiness and then contradicting itself — a bigger
          // catalog just makes that window longer and the flash more visible.
          isLoading && recipes.length === 0 ? null : (
            <NoResults
              onReset={resetFilters}
              title={t.recipes_catalog.no_results_heading}
              subtitle={t.recipes_catalog.no_results_body}
            />
          )
        ) : (
          <RecipesTableResults
            recipes={filtered}
            eligibilityMap={eligibilityMap}
            highlight={debouncedSearch}
            personaSelected={!!selectedPersona}
            adoptedRecipeIds={adoptedRecipeIds}
            staleRecipeIds={staleRecipeIds}
            onOpenDetail={onOpenDetail}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category dropdown (Listbox-based — scales to many options)
// ---------------------------------------------------------------------------

interface CategoryDropdownProps {
  value: RecipeCategory | 'all';
  onChange: (v: RecipeCategory | 'all') => void;
  categoryOptions: CategoryOption[];
}

function CategoryDropdown({ value, onChange, categoryOptions }: CategoryDropdownProps) {
  const { t } = useTranslation();
  const current = categoryOptions.find((o) => o.value === value) ?? categoryOptions[0]!;
  const isAll = value === 'all';
  return (
    <Listbox
      ariaLabel={t.recipes_catalog.category_filter_aria}
      itemCount={categoryOptions.length}
      onSelectFocused={(i) => {
        const opt = categoryOptions[i];
        if (opt) onChange(opt.value);
      }}
      // Filter row sits over the table — opaque dropdown so options don't
      // bleed into table rows visible behind.
      menuClassName="animate-fade-slide-in absolute top-full mt-1 left-0 min-w-[200px] bg-card-bg border border-card-border rounded-modal shadow-elevation-4 z-[100] overflow-hidden"
      renderTrigger={({ isOpen, toggle }) => (
        <Tooltip content={t.recipes_catalog.category_filter_aria}>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={isOpen}
            aria-label={t.recipes_catalog.category_filter_aria}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-input border typo-caption transition-colors cursor-pointer ${
              isAll
                ? 'border-card-border bg-secondary/40 text-foreground/85 hover:border-foreground/30'
                : 'border-primary/35 bg-primary/12 text-primary hover:bg-primary/22'
            }`}
          >
            <span className="typo-label opacity-70">
              {t.recipes_catalog.category_filter_prefix}
            </span>
            <span>{current.label}</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        </Tooltip>
      )}
    >
      {({ close, focusIndex }) => (
        <div className="py-1 max-h-[60vh] overflow-y-auto">
          {categoryOptions.map((opt, i) => {
            const isActive = value === opt.value;
            const isFocused = focusIndex === i;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => { onChange(opt.value); close(); }}
                className={`flex items-center gap-2 w-full px-3 py-2 typo-caption transition-colors cursor-pointer text-left ${
                  isFocused ? 'bg-secondary/60' : 'hover:bg-secondary/40'
                } ${isActive ? 'text-primary' : 'text-foreground'}`}
              >
                <span className="flex-1">{opt.label}</span>
                {isActive && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </Listbox>
  );
}

// ---------------------------------------------------------------------------
// Eligibility filter chips
// ---------------------------------------------------------------------------

interface EligibilityFilterChipProps {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  icon?: React.ReactNode;
  tone?: 'success' | 'warning' | 'muted';
}

function EligibilityFilterChip({ active, onClick, label, count, icon, tone }: EligibilityFilterChipProps) {
  const toneCls = tone === 'success'
    ? 'bg-status-success/12 border-status-success/35 text-status-success/95'
    : tone === 'warning'
      ? 'bg-status-warning/12 border-status-warning/35 text-status-warning/95'
      : tone === 'muted'
        ? 'bg-secondary/60 border-card-border text-foreground'
        : 'bg-primary/12 border-primary/35 text-primary';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full typo-caption transition-colors cursor-pointer border ${
        active ? toneCls : 'bg-secondary/40 border-card-border/60 text-foreground hover:text-foreground hover:border-foreground/30'
      }`}
    >
      {icon}
      {label}
      {count !== undefined && count > 0 && (
        <span className="font-mono opacity-80">{count}</span>
      )}
    </button>
  );
}
