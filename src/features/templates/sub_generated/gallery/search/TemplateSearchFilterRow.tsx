import { Star } from 'lucide-react';
import { List, Compass } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { DensityToggle, type Density } from './filters/DensityToggle';
import { SortDropdown } from './filters/SortDropdown';
import { FilterChips } from './filters/FilterChips';
import { ComponentFilterDropdown } from './filters/ComponentFilterDropdown';
import { AdminToolsDropdown } from './filters/AdminToolsDropdown';
import type { ConnectorWithCount } from '@/api/overview/reviews';

interface TemplateSearchFilterRowProps {
  viewMode?: 'list' | 'explore';
  onViewModeChange?: (v: 'list' | 'explore') => void;
  density?: Density;
  onDensityChange?: (d: Density) => void;
  sortBy: string;
  onSortByChange: (value: string) => void;
  sortDir: string;
  onSortDirChange: (value: string) => void;
  total: number;
  loadedCount: number;
  // Recommended
  hasRecommendations?: boolean;
  onOpenRecommended?: () => void;
  // Filter row
  selectedCategory: string | null;
  connectorFilter: string[];
  onCategoryFilterChange: (categories: string[]) => void;
  onConnectorFilterChange: (connectors: string[]) => void;
  availableConnectors: ConnectorWithCount[];
  coverageFilter?: string;
  onCoverageFilterChange?: (value: string) => void;
  coverageCounts?: { all: number; ready: number; partial: number };
  // Component filter
  componentFilter?: string[];
  onComponentFilterChange?: (components: string[]) => void;
  availableComponents?: { key: string; count: number }[];
  // Admin
  onCleanupDuplicates?: () => void;
  isCleaningUp?: boolean;
  onBackfillPipeline?: () => void;
  isBackfillingPipeline?: boolean;
  onBackfillTools?: () => void;
  isBackfillingTools?: boolean;
}

export function TemplateSearchControls({
  viewMode,
  onViewModeChange,
  density,
  onDensityChange,
  sortBy,
  onSortByChange,
  sortDir,
  onSortDirChange,
  total,
  loadedCount,
  hasRecommendations,
  onOpenRecommended,
}: Pick<TemplateSearchFilterRowProps, 'viewMode' | 'onViewModeChange' | 'density' | 'onDensityChange' | 'sortBy' | 'onSortByChange' | 'sortDir' | 'onSortDirChange' | 'total' | 'loadedCount' | 'hasRecommendations' | 'onOpenRecommended'>) {
  const { t } = useTranslation();
  return (
    <>
      {/* Count */}
      {total > 0 && (
        <span className="text-sm text-muted-foreground/50 tabular-nums flex-shrink-0 hidden sm:inline">
          {loadedCount < total ? `${loadedCount}/${total}` : `${total}`}
        </span>
      )}

      {/* View mode toggle */}
      {onViewModeChange && (
        <div className="inline-flex items-center rounded-card border border-primary/15 overflow-hidden flex-shrink-0">
          <button
            onClick={() => onViewModeChange('list')}
            className={`p-1.5 transition-colors ${
              viewMode === 'list'
                ? 'bg-violet-500/20 text-violet-300'
                : 'text-muted-foreground/60 hover:text-muted-foreground/80 hover:bg-secondary/40'
            }`}
            title={t.templates.search.list_view}
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
            title={t.templates.search.explore_view}
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
          className="p-2 rounded-card border border-primary/10 hover:bg-amber-500/10 text-amber-400/60 hover:text-amber-400 transition-colors flex-shrink-0"
          title={t.templates.search.recommended_for_you}
        >
          <Star className="w-4 h-4" />
        </button>
      )}
    </>
  );
}

export function TemplateSearchFilterRow({
  viewMode,
  selectedCategory,
  connectorFilter,
  onCategoryFilterChange,
  onConnectorFilterChange,
  availableConnectors: _availableConnectors,
  coverageFilter,
  onCoverageFilterChange,
  coverageCounts,
  componentFilter,
  onComponentFilterChange,
  availableComponents,
  onCleanupDuplicates,
  isCleaningUp,
  onBackfillPipeline,
  isBackfillingPipeline,
  onBackfillTools,
  isBackfillingTools,
}: TemplateSearchFilterRowProps) {
  if (viewMode === 'explore') return null;

  return (
    <div className="px-4 pb-2.5 flex items-center gap-2">
      <FilterChips
        selectedCategory={selectedCategory}
        connectorFilter={connectorFilter}
        onCategoryFilterChange={onCategoryFilterChange}
        onConnectorFilterChange={onConnectorFilterChange}
        coverageFilter={coverageFilter}
        onCoverageFilterChange={onCoverageFilterChange}
        coverageCounts={coverageCounts}
        componentFilter={componentFilter}
        onComponentFilterChange={onComponentFilterChange}
      />

      {onComponentFilterChange && availableComponents && (
        <ComponentFilterDropdown
          availableComponents={availableComponents}
          componentFilter={componentFilter ?? []}
          setComponentFilter={onComponentFilterChange}
        />
      )}

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
  );
}
