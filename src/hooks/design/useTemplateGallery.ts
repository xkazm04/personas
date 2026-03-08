import { useCallback, useRef } from 'react';
import type { ConnectorWithCount, CategoryWithCount } from '@/api/reviews';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { useGalleryQuery, type UseGalleryQueryReturn } from './useGalleryQuery';
import { useAiSearch } from './useAiSearch';

export type { ConnectorWithCount, CategoryWithCount };

export interface UseTemplateGalleryReturn {
  allItems: PersonaDesignReview[];
  total: number;
  hasMore: boolean;
  isFetchingMore: boolean;
  fetchMore: () => void;
  search: string;
  setSearch: (s: string) => void;
  connectorFilter: string[];
  setConnectorFilter: (c: string[]) => void;
  categoryFilter: string[];
  setCategoryFilter: (c: string[]) => void;
  sortBy: string;
  setSortBy: (s: string) => void;
  sortDir: string;
  setSortDir: (d: string) => void;
  isLoading: boolean;
  refresh: () => void;
  availableConnectors: ConnectorWithCount[];
  availableCategories: CategoryWithCount[];
  trendingTemplates: PersonaDesignReview[];
  readyTemplates: PersonaDesignReview[];
  recommendedTemplates: PersonaDesignReview[];
  coverageFilter: string;
  setCoverageFilter: (f: string) => void;
  // AI search
  aiSearchMode: boolean;
  setAiSearchMode: (m: boolean) => void;
  aiSearchLoading: boolean;
  aiSearchRationale: string;
  aiSearchActive: boolean;
  triggerAiSearch: (query: string) => void;
  clearAiSearch: () => void;
  aiCliLog: string[];
}

export function useTemplateGallery(coverageServiceTypes?: string[]): UseTemplateGalleryReturn {
  // Ref to break the circular dependency: AI search needs to write into query state,
  // but query needs aiSearchActive from AI search.
  const queryRef = useRef<UseGalleryQueryReturn>(null!);

  const handleAiResults = useCallback((items: PersonaDesignReview[], total: number) => {
    queryRef.current.setItems(items);
    queryRef.current.setTotal(total);
  }, []);

  const ai = useAiSearch(handleAiResults);

  const query = useGalleryQuery(coverageServiceTypes, ai.aiSearchActive);
  queryRef.current = query;

  // Compose search setter: in AI mode clear AI state on empty input
  const setSearch = useCallback((value: string) => {
    queryRef.current.setSearch(value);
    if (ai.aiSearchMode && !value.trim()) {
      ai.clearAiSearch();
    }
  }, [ai.aiSearchMode, ai.clearAiSearch]);

  return {
    allItems: query.items,
    total: query.total,
    hasMore: query.hasMore,
    isFetchingMore: query.isFetchingMore,
    fetchMore: query.fetchMore,
    search: query.search,
    setSearch,
    connectorFilter: query.connectorFilter,
    setConnectorFilter: query.setConnectorFilter,
    categoryFilter: query.categoryFilter,
    setCategoryFilter: query.setCategoryFilter,
    sortBy: query.sortBy,
    setSortBy: query.setSortBy,
    sortDir: query.sortDir,
    setSortDir: query.setSortDir,
    isLoading: query.isLoading,
    refresh: query.refresh,
    availableConnectors: query.availableConnectors,
    availableCategories: query.availableCategories,
    trendingTemplates: query.trendingTemplates,
    readyTemplates: query.readyTemplates,
    recommendedTemplates: query.recommendedTemplates,
    coverageFilter: query.coverageFilter,
    setCoverageFilter: query.setCoverageFilter,
    // AI search
    aiSearchMode: ai.aiSearchMode,
    setAiSearchMode: ai.setAiSearchMode,
    aiSearchLoading: ai.aiSearchLoading,
    aiSearchRationale: ai.aiSearchRationale,
    aiSearchActive: ai.aiSearchActive,
    triggerAiSearch: ai.triggerAiSearch,
    clearAiSearch: ai.clearAiSearch,
    aiCliLog: ai.aiCliLog,
  };
}
