import { DensityToggle, type Density } from './filters/DensityToggle';
import { SortDropdown } from './filters/SortDropdown';
import { FilterChips } from './filters/FilterChips';
import { ComponentFilterDropdown } from './filters/ComponentFilterDropdown';
import { ConnectorFilterDropdown } from './filters/ConnectorFilterDropdown';
import { AdminToolsDropdown } from './filters/AdminToolsDropdown';
import { Users } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
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
  coverageCounts?: { all: number; ready: number; partial: number; drafts?: number };
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
  /** Opens the team-synthesis panel. */
  onSynthesizeTeam?: () => void;
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
  return (
    <>
      {/* Count */}
      {total > 0 && (
        <span className="typo-data text-foreground tabular-nums flex-shrink-0 hidden sm:inline">
          {loadedCount < total ? `${loadedCount}/${total}` : `${total}`}
        </span>
      )}

      {/* Density toggle */}
      {density && onDensityChange && (
        <DensityToggle density={density} onChange={onDensityChange} />
      )}

      {/* Sort */}
      <SortDropdown
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(by, dir) => {
          onSortByChange(by);
          onSortDirChange(dir);
        }}
      />
    </>
  );
}

export function TemplateSearchFilterRow({
  selectedCategory,
  connectorFilter,
  onCategoryFilterChange,
  onConnectorFilterChange,
  availableConnectors,
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
  onSynthesizeTeam,
}: TemplateSearchFilterRowProps) {
  const { t } = useTranslation();
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

      {availableConnectors.length > 0 && (
        <ConnectorFilterDropdown
          availableConnectors={availableConnectors}
          connectorFilter={connectorFilter}
          setConnectorFilter={onConnectorFilterChange}
        />
      )}

      {onComponentFilterChange && availableComponents && (
        <ComponentFilterDropdown
          availableComponents={availableComponents}
          componentFilter={componentFilter ?? []}
          setComponentFilter={onComponentFilterChange}
        />
      )}

      <div className="flex-1" />

      {/* The catalog should compose, not only list: TeamSynthesisPanel could
          already build a team out of these templates and had no consumer, while
          the gallery's own empty state told operators to press a Synthesize
          Team button that did not exist. */}
      {onSynthesizeTeam && (
        <button
          type="button"
          onClick={onSynthesizeTeam}
          data-testid="gallery-synthesize-team"
          className="focus-ring px-3 py-2 typo-body rounded-modal border border-primary/15 hover:bg-secondary/50 text-foreground transition-colors flex items-center gap-1.5 flex-shrink-0"
        >
          <Users className="w-3.5 h-3.5" aria-hidden="true" />
          {t.templates.team_synthesis.synthesize_team}
        </button>
      )}

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
