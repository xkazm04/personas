import { useMemo, useState } from 'react';
import {
  Search, Sparkles, AlertTriangle, Lock, Check, ChevronDown,
} from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { Recipe, RecipeCategory } from '../types';
import { useRecipeEligibilityMap } from '../useEligibility';
import { getCategoryLabels } from '../libs/categoryLabels';
import { RecipesTableResults } from './RecipesTableResults';

interface RecipesBrowseListProps {
  recipes: Recipe[];
  /** Search is owned by RecipesPage so detail-view tag clicks can land
   *  back in browse with the filter pre-applied. */
  search: string;
  onSearchChange: (value: string) => void;
  onOpenDetail: (recipeId: string) => void;
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
 */
export function RecipesBrowseList({ recipes, search, onSearchChange, onOpenDetail }: RecipesBrowseListProps) {
  const { t } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const eligibilityMap = useRecipeEligibilityMap(recipes);

  const [category, setCategory] = useState<RecipeCategory | 'all'>('all');
  const [eligibilityFilter, setEligibilityFilter] = useState<EligibilityFilter>('all');

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
    const q = search.trim().toLowerCase();
    return recipes.filter((r) => {
      if (category !== 'all' && r.category !== category) return false;
      if (selectedPersona && eligibilityFilter !== 'all') {
        const e = eligibilityMap.get(r.id);
        if (!e || e.state !== eligibilityFilter) return false;
      }
      if (q) {
        const hay = [r.name, r.summary, r.description, ...r.tags].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [recipes, search, category, eligibilityFilter, eligibilityMap, selectedPersona]);

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
          <div className="typo-label uppercase tracking-wider text-foreground">{t.recipes_catalog.available_label}</div>
        </div>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-card-border/40 flex-shrink-0 flex-wrap">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground pointer-events-none" />
          <input
            type="search"
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

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className="p-4">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16 typo-caption text-foreground">
              <Search className="w-8 h-8 mb-2 text-foreground" />
              <div className="typo-body font-medium text-foreground/85 mb-1">{t.recipes_catalog.no_results_heading}</div>
              <div>{t.recipes_catalog.no_results_body}</div>
            </div>
          ) : (
            <RecipesTableResults
              recipes={filtered}
              eligibilityMap={eligibilityMap}
              highlight={search}
              onOpenDetail={onOpenDetail}
            />
          )}
        </div>
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
      menuClassName="animate-fade-slide-in absolute top-full mt-1 left-0 min-w-[200px] bg-card-bg border border-card-border rounded-xl shadow-elevation-4 z-[100] overflow-hidden"
      renderTrigger={({ isOpen, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-input border typo-caption transition-colors cursor-pointer ${
            isAll
              ? 'border-card-border bg-secondary/40 text-foreground/85 hover:border-foreground/30'
              : 'border-primary/35 bg-primary/12 text-primary hover:bg-primary/22'
          }`}
          title={t.recipes_catalog.category_filter_aria}
        >
          <span className="typo-label uppercase tracking-wider opacity-70 normal-case tracking-normal">
            {t.recipes_catalog.category_filter_prefix}
          </span>
          <span className="font-medium">{current.label}</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
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
