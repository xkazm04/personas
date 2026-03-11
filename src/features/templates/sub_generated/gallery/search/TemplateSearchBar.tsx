import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { AiSearchStatusBar } from './suggestions/AiSearchStatusBar';
import { useStructuredQuery } from './suggestions/useStructuredQuery';
import { TemplateSearchControls, TemplateSearchFilterRow } from './TemplateSearchFilterRow';
import { SearchChipInput } from './suggestions/SearchChipInput';
import type { TemplateSearchBarProps } from './TemplateSearchBarTypes';

export type { TemplateSearchBarProps };

export function TemplateSearchBar(props: TemplateSearchBarProps) {
  const {
    search, onSearchChange, sortBy, onSortByChange, sortDir, onSortDirChange,
    connectorFilter, onConnectorFilterChange, categoryFilter, onCategoryFilterChange,
    availableConnectors, availableCategories, total, loadedCount,
    onCleanupDuplicates, isCleaningUp, onBackfillPipeline, isBackfillingPipeline,
    onBackfillTools, isBackfillingTools, coverageFilter, onCoverageFilterChange, coverageCounts,
    density, onDensityChange, viewMode, onViewModeChange,
    aiSearchMode, onAiSearchToggle, aiSearchLoading, aiSearchRationale, aiSearchActive,
    onAiSearchSubmit, aiCliLog, hasRecommendations, onOpenRecommended,
  } = props;

  const query = useStructuredQuery(onCategoryFilterChange, onSearchChange);
  const selectedCategory: string | null = categoryFilter[0] ?? null;

  const showAiSuggestion = useMemo(() => {
    return !aiSearchActive && !aiSearchLoading && !aiSearchMode
      && total > 0 && total < 3 && search.trim().length >= 5;
  }, [aiSearchActive, aiSearchLoading, aiSearchMode, total, search]);

  return (
    <div className="border-b border-primary/10 flex-shrink-0">
      <div className="px-4 py-2.5 flex items-center gap-2">
        {onAiSearchToggle && (
          <Button onClick={onAiSearchToggle}
            variant="ghost"
            size="icon-sm"
            className={`border flex-shrink-0 ${aiSearchMode ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300' : 'border-primary/10 text-muted-foreground/50 hover:text-muted-foreground/80 hover:bg-secondary/40'}`}
            title={aiSearchMode ? 'Switch to keyword search' : 'Switch to AI search'}>
            <Sparkles className="w-4 h-4" />
          </Button>
        )}

        <SearchChipInput
          chips={query.chips} inputValue={query.inputValue} setInputValue={query.setInputValue}
          removeChip={query.removeChip} addChip={query.addChip} clearAll={query.clearAll}
          autocompletePrefix={query.autocompletePrefix} autocompleteQuery={query.autocompleteQuery}
          aiSearchMode={aiSearchMode} aiSearchLoading={aiSearchLoading}
          onAiSearchSubmit={onAiSearchSubmit} availableCategories={availableCategories}
        />

        <TemplateSearchControls
          viewMode={viewMode} onViewModeChange={onViewModeChange}
          density={density} onDensityChange={onDensityChange}
          sortBy={sortBy} onSortByChange={onSortByChange} sortDir={sortDir} onSortDirChange={onSortDirChange}
          total={total} loadedCount={loadedCount}
          hasRecommendations={hasRecommendations} onOpenRecommended={onOpenRecommended}
        />
      </div>

      <AiSearchStatusBar aiSearchMode={aiSearchMode} aiSearchLoading={aiSearchLoading}
        aiSearchRationale={aiSearchRationale} aiSearchActive={aiSearchActive} aiCliLog={aiCliLog} total={total} />

      {showAiSuggestion && onAiSearchSubmit && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-500/5 border border-indigo-500/10">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400/60 flex-shrink-0" />
            <span className="text-sm text-indigo-300/70 flex-1">Few results found</span>
            <Button onClick={() => onAiSearchSubmit(search.trim())}
              variant="secondary"
              size="xs"
              className="bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 hover:bg-indigo-500/25">
              Try AI search
            </Button>
          </div>
        </div>
      )}

      <TemplateSearchFilterRow
        viewMode={viewMode} selectedCategory={selectedCategory}
        connectorFilter={connectorFilter} onCategoryFilterChange={onCategoryFilterChange}
        onConnectorFilterChange={onConnectorFilterChange} availableConnectors={availableConnectors}
        coverageFilter={coverageFilter} onCoverageFilterChange={onCoverageFilterChange} coverageCounts={coverageCounts}
        onCleanupDuplicates={onCleanupDuplicates} isCleaningUp={isCleaningUp}
        onBackfillPipeline={onBackfillPipeline} isBackfillingPipeline={isBackfillingPipeline}
        onBackfillTools={onBackfillTools} isBackfillingTools={isBackfillingTools}
        sortBy={sortBy} onSortByChange={onSortByChange} sortDir={sortDir} onSortDirChange={onSortDirChange}
        total={total} loadedCount={loadedCount}
      />
    </div>
  );
}
