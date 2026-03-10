import type { ConnectorWithCount, CategoryWithCount } from '@/api/overview/reviews';
import type { Density } from './filters/DensityToggle';

export interface TemplateSearchBarProps {
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
