import { DensityToggle, type Density } from './filters/DensityToggle';
import { SortDropdown } from './filters/SortDropdown';
import { FilterChips } from './filters/FilterChips';
import { ComponentFilterDropdown } from './filters/ComponentFilterDropdown';
import { AdminToolsDropdown } from './filters/AdminToolsDropdown';
import type { ConnectorWithCount } from '@/api/overview/reviews';

interface TemplateSearchFilterRowProps {
  density?: Density;
  onDensityChange?: (d: Density) => void;
  sortBy: string;
  onSortByChange: (value: string) => void;
  sortDir: string;
  onSortDirChange: (value: string) => void;
  total: number;
  loadedCount: number;
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
  density,
  onDensityChange,
  sortBy,
  onSortByChange,
  sortDir,
  onSortDirChange,
  total,
  loadedCount,
}: Pick<TemplateSearchFilterRowProps, 'density' | 'onDensityChange' | 'sortBy' | 'onSortByChange' | 'sortDir' | 'onSortDirChange' | 'total' | 'loadedCount'>) {
  const showListControls = density !== 'role';
  return (
    <>
      {/* Count */}
      {total > 0 && (
        <span className="typo-data text-foreground tabular-nums flex-shrink-0 hidden sm:inline">
          {loadedCount < total ? `${loadedCount}/${total}` : `${total}`}
        </span>
      )}

      {/* Density toggle (includes By Role) */}
      {density && onDensityChange && (
        <DensityToggle density={density} onChange={onDensityChange} />
      )}

      {/* Sort (list modes only) */}
      {showListControls && (
        <SortDropdown
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={(by, dir) => {
            onSortByChange(by);
            onSortDirChange(dir);
          }}
        />
      )}
    </>
  );
}

export function TemplateSearchFilterRow({
  density,
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
  if (density === 'role') return null;

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
