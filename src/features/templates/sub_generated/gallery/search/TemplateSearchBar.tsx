import { useMemo } from 'react';
import {
  Search,
  X,
  Sparkles,
  Loader2,
  Send,
  List,
  Compass,
  Star,
} from 'lucide-react';
import type { ConnectorWithCount, CategoryWithCount } from '@/api/overview/reviews';
import { ConnectorFilterDropdown } from './ConnectorFilterDropdown';
import { SortDropdown } from './SortDropdown';
import { AdminToolsDropdown } from './AdminToolsDropdown';
import { AiSearchStatusBar } from './AiSearchStatusBar';
import { FilterChips } from './FilterChips';
import { SearchAutocomplete } from './SearchAutocomplete';
import { DensityToggle, type Density } from './DensityToggle';
import { useStructuredQuery } from './useStructuredQuery';
import { getCategoryMeta } from './searchConstants';

// ── Props ────────────────────────────────────────────────────────

interface TemplateSearchBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  sortBy: string;
  onSortByChange: (value: string) => void;
  sortDir: string;
  onSortDirChange: (value: string) => void;
  connectorFilter: string[];
  onConnectorFilterChange: (connectors: string[]) => void;
  categoryFilter: string[];
  onCategoryFilterChange: (categories: string[]) => void;
  availableConnectors: ConnectorWithCount[];
  availableCategories: CategoryWithCount[];
  total: number;
  loadedCount: number;
  onCleanupDuplicates?: () => void;
  isCleaningUp?: boolean;
  onBackfillPipeline?: () => void;
  isBackfillingPipeline?: boolean;
  onBackfillTools?: () => void;
  isBackfillingTools?: boolean;
  coverageFilter?: string;
  onCoverageFilterChange?: (value: string) => void;
  coverageCounts?: { all: number; ready: number; partial: number };
  // Density & view mode
  density?: Density;
  onDensityChange?: (d: Density) => void;
  viewMode?: 'list' | 'explore';
  onViewModeChange?: (v: 'list' | 'explore') => void;
  // AI search
  aiSearchMode?: boolean;
  onAiSearchToggle?: () => void;
  aiSearchLoading?: boolean;
  aiSearchRationale?: string;
  aiSearchActive?: boolean;
  onAiSearchSubmit?: (query: string) => void;
  aiCliLog?: string[];
  // Recommended
  hasRecommendations?: boolean;
  onOpenRecommended?: () => void;
}

// ── Main Component ───────────────────────────────────────────────

export function TemplateSearchBar({
  search,
  onSearchChange,
  sortBy,
  onSortByChange,
  sortDir,
  onSortDirChange,
  connectorFilter,
  onConnectorFilterChange,
  categoryFilter,
  onCategoryFilterChange,
  availableConnectors,
  availableCategories,
  total,
  loadedCount,
  onCleanupDuplicates,
  isCleaningUp,
  onBackfillPipeline,
  isBackfillingPipeline,
  onBackfillTools,
  isBackfillingTools,
  coverageFilter,
  onCoverageFilterChange,
  coverageCounts,
  density,
  onDensityChange,
  viewMode,
  onViewModeChange,
  aiSearchMode,
  onAiSearchToggle,
  aiSearchLoading,
  aiSearchRationale,
  aiSearchActive,
  onAiSearchSubmit,
  aiCliLog,
  hasRecommendations,
  onOpenRecommended,
}: TemplateSearchBarProps) {
  const query = useStructuredQuery(onCategoryFilterChange, onSearchChange);

  // Sync external category filter into chips (e.g. when set from explore view)
  const selectedCategory: string | null = categoryFilter[0] ?? null;

  // Show AI suggestion when few keyword results and meaningful query
  const showAiSuggestion = useMemo(() => {
    return !aiSearchActive && !aiSearchLoading && !aiSearchMode
      && total > 0 && total < 3
      && search.trim().length >= 5;
  }, [aiSearchActive, aiSearchLoading, aiSearchMode, total, search]);

  return (
    <div className="border-b border-primary/10 flex-shrink-0">
      {/* Single row — Search + Controls */}
      <div className="px-4 py-2.5 flex items-center gap-2">
        {/* AI toggle */}
        {onAiSearchToggle && (
          <button
            onClick={onAiSearchToggle}
            className={`p-2 rounded-xl border transition-all flex-shrink-0 ${
              aiSearchMode
                ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300'
                : 'border-primary/10 text-muted-foreground/50 hover:text-muted-foreground/80 hover:bg-secondary/40'
            }`}
            title={aiSearchMode ? 'Switch to keyword search' : 'Switch to AI search'}
          >
            <Sparkles className="w-4 h-4" />
          </button>
        )}

        {/* Chip input container */}
        <div className={`relative flex-1 min-w-0 flex items-center flex-wrap gap-1 bg-secondary/40 border rounded-xl transition-all ${
          aiSearchMode
            ? 'border-indigo-500/20 focus-within:border-indigo-500/40 focus-within:ring-1 focus-within:ring-indigo-500/20'
            : 'border-primary/10 focus-within:border-violet-500/30 focus-within:ring-1 focus-within:ring-violet-500/20'
        }`}>
          {/* Search icon */}
          <div className="pl-3 flex-shrink-0">
            {aiSearchMode && aiSearchLoading ? (
              <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
            ) : (
              <Search className="w-4 h-4 text-muted-foreground/50" />
            )}
          </div>

          {/* Chips */}
          {query.chips.map((chip, i) => {
            const meta = chip.type === 'category' ? getCategoryMeta(chip.value) : null;
            const Icon = meta?.icon;
            return (
              <span
                key={`${chip.type}-${chip.value}`}
                className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 text-sm rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 flex-shrink-0"
              >
                {Icon && <Icon className="w-3 h-3" style={{ color: meta?.color }} />}
                {chip.label}
                <button
                  onClick={() => query.removeChip(i)}
                  className="ml-0.5 p-0.5 hover:text-white transition-colors rounded-full hover:bg-violet-500/20"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            );
          })}

          {/* Text input */}
          <input
            type="text"
            value={query.inputValue}
            onChange={(e) => query.setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && aiSearchMode && onAiSearchSubmit && query.inputValue.trim()) {
                e.preventDefault();
                onAiSearchSubmit(query.inputValue.trim());
              }
              // Backspace on empty input removes last chip
              if (e.key === 'Backspace' && !query.inputValue && query.chips.length > 0) {
                query.removeChip(query.chips.length - 1);
              }
            }}
            placeholder={
              query.chips.length > 0
                ? 'Add more filters or search...'
                : aiSearchMode
                  ? 'Describe what you need, then press Enter...'
                  : 'Search templates... (try category:monitoring)'
            }
            className="flex-1 min-w-[120px] py-2 pr-10 text-sm bg-transparent text-foreground/90 placeholder:text-muted-foreground/40 focus:outline-none"
          />

          {/* Right controls inside input */}
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {aiSearchMode ? (
              <>
                {query.inputValue && (
                  <button
                    onClick={() => query.clearAll()}
                    className="p-1 text-muted-foreground/50 hover:text-foreground/70"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => onAiSearchSubmit?.(query.inputValue.trim())}
                  disabled={!query.inputValue.trim() || aiSearchLoading}
                  className="p-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  title="Search with AI"
                >
                  {aiSearchLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                </button>
              </>
            ) : (
              (query.inputValue || query.chips.length > 0) && (
                <button
                  onClick={() => query.clearAll()}
                  className="p-1 text-muted-foreground/50 hover:text-foreground/70"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )
            )}
          </div>

          {/* Autocomplete dropdown */}
          {query.autocompletePrefix && !aiSearchMode && (
            <SearchAutocomplete
              prefix={query.autocompletePrefix}
              query={query.autocompleteQuery}
              availableCategories={availableCategories}
              activeChips={query.chips}
              onSelect={(chip) => query.addChip(chip)}
              onDismiss={() => {
                // Clear the prefix text
                const words = query.inputValue.split(/\s+/);
                query.setInputValue(words.slice(0, -1).join(' '));
              }}
            />
          )}
        </div>

        {/* Count */}
        {total > 0 && (
          <span className="text-sm text-muted-foreground/50 tabular-nums flex-shrink-0 hidden sm:inline">
            {loadedCount < total ? `${loadedCount}/${total}` : `${total}`}
          </span>
        )}

        {/* View mode toggle */}
        {onViewModeChange && (
          <div className="inline-flex items-center rounded-lg border border-primary/15 overflow-hidden flex-shrink-0">
            <button
              onClick={() => onViewModeChange('list')}
              className={`p-1.5 transition-colors ${
                viewMode === 'list'
                  ? 'bg-violet-500/20 text-violet-300'
                  : 'text-muted-foreground/60 hover:text-muted-foreground/80 hover:bg-secondary/40'
              }`}
              title="List view"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onViewModeChange('explore')}
              className={`p-1.5 transition-colors ${
                viewMode === 'explore'
                  ? 'bg-violet-500/20 text-violet-300'
                  : 'text-muted-foreground/60 hover:text-muted-foreground/80 hover:bg-secondary/40'
              }`}
              title="Explore view"
            >
              <Compass className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Density toggle (list mode only) */}
        {viewMode !== 'explore' && density && onDensityChange && (
          <DensityToggle density={density} onChange={onDensityChange} />
        )}

        {/* Sort (list mode only) */}
        {viewMode !== 'explore' && (
          <SortDropdown
            sortBy={sortBy}
            sortDir={sortDir}
            onSortChange={(by, dir) => {
              onSortByChange(by);
              onSortDirChange(dir);
            }}
          />
        )}

        {/* Recommended for You */}
        {hasRecommendations && onOpenRecommended && (
          <button
            onClick={onOpenRecommended}
            className="p-2 rounded-lg border border-primary/10 hover:bg-amber-500/10 text-amber-400/60 hover:text-amber-400 transition-colors flex-shrink-0"
            title="Recommended for you"
          >
            <Star className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* AI search status bar */}
      <AiSearchStatusBar
        aiSearchMode={aiSearchMode}
        aiSearchLoading={aiSearchLoading}
        aiSearchRationale={aiSearchRationale}
        aiSearchActive={aiSearchActive}
        aiCliLog={aiCliLog}
        total={total}
      />

      {/* AI suggestion prompt (when few keyword results) */}
      {showAiSuggestion && onAiSearchSubmit && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-500/5 border border-indigo-500/10">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400/60 flex-shrink-0" />
            <span className="text-sm text-indigo-300/70 flex-1">Few results found</span>
            <button
              onClick={() => onAiSearchSubmit(search.trim())}
              className="text-sm px-2.5 py-1 rounded-xl bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 hover:bg-indigo-500/25 transition-colors"
            >
              Try AI search
            </button>
          </div>
        </div>
      )}

      {/* Row 2 -- Filter chips + connector filter + admin tools */}
      {viewMode !== 'explore' && (
        <div className="px-4 pb-2.5 flex items-center gap-2">
          <FilterChips
            selectedCategory={selectedCategory}
            connectorFilter={connectorFilter}
            onCategoryFilterChange={onCategoryFilterChange}
            onConnectorFilterChange={onConnectorFilterChange}
            coverageFilter={coverageFilter}
            onCoverageFilterChange={onCoverageFilterChange}
            coverageCounts={coverageCounts}
          />

          <ConnectorFilterDropdown
            availableConnectors={availableConnectors}
            connectorFilter={connectorFilter}
            setConnectorFilter={onConnectorFilterChange}
          />

          <div className="flex-1" />

          {/* Admin tools dropdown -- dev mode only */}
          {import.meta.env.DEV && (onCleanupDuplicates || onBackfillPipeline || onBackfillTools) && (
            <AdminToolsDropdown
              onCleanupDuplicates={onCleanupDuplicates}
              isCleaningUp={isCleaningUp}
              onBackfillPipeline={onBackfillPipeline}
              isBackfillingPipeline={isBackfillingPipeline}
              onBackfillTools={onBackfillTools}
              isBackfillingTools={isBackfillingTools}
            />
          )}
        </div>
      )}
    </div>
  );
}
