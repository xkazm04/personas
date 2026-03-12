import { useState, useCallback, useEffect, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import {
  listDesignReviewsPaginated,
  listReviewConnectors,
  listReviewCategories,
  getTrendingTemplates,
  backfillReviewCategories,
  type PaginatedReviewsResult,
  type ConnectorWithCount,
  type CategoryWithCount,
} from '@/api/overview/reviews';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

export interface UseGalleryQueryReturn {
  items: PersonaDesignReview[];
  total: number;
  hasMore: boolean;
  isFetchingMore: boolean;
  fetchMore: () => void;
  search: string;
  setSearch: (s: string) => void;
  debouncedSearch: string;
  connectorFilter: string[];
  setConnectorFilter: (c: string[]) => void;
  categoryFilter: string[];
  setCategoryFilter: (c: string[]) => void;
  sortBy: string;
  setSortBy: (s: string) => void;
  sortDir: string;
  setSortDir: (d: string) => void;
  coverageFilter: string;
  setCoverageFilter: (f: string) => void;
  isLoading: boolean;
  refresh: () => void;
  availableConnectors: ConnectorWithCount[];
  availableCategories: CategoryWithCount[];
  trendingTemplates: PersonaDesignReview[];
  readyTemplates: PersonaDesignReview[];
  recommendedTemplates: PersonaDesignReview[];
  setItems: React.Dispatch<React.SetStateAction<PersonaDesignReview[]>>;
  setTotal: React.Dispatch<React.SetStateAction<number>>;
  fetchPage: (pageNum: number, append: boolean) => Promise<void>;
}

const PER_PAGE = 50;
const DEBOUNCE_MS = 150;
const MAX_RECOMMENDATIONS = 8;

/**
 * Score templates by relevance to the user's installed connectors.
 */
function scoreRecommendations(
  templates: PersonaDesignReview[],
  userServiceTypes: string[],
): PersonaDesignReview[] {
  const userServices = new Set(userServiceTypes.map((s) => s.toLowerCase()));

  const scored = templates.map((t) => {
    let connectors: string[] = [];
    try {
      connectors = t.connectors_used ? JSON.parse(t.connectors_used) : [];
    } catch { /* intentional: non-critical */ }

    const matchCount = connectors.filter((c) => userServices.has(c.toLowerCase())).length;
    const connectorScore = matchCount * 2;
    const popularityBonus = t.adoption_count > 0 ? Math.log2(t.adoption_count + 1) : 0;
    const totalConnectors = connectors.length;
    const coverageRatio = totalConnectors > 0 ? matchCount / totalConnectors : 0;
    const coverageBonus = coverageRatio * 1.5;
    const score = connectorScore + popularityBonus + coverageBonus;
    return { template: t, score, matchCount };
  });

  return scored
    .filter((s) => s.matchCount > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RECOMMENDATIONS)
    .map((s) => s.template);
}

export function useGalleryQuery(
  coverageServiceTypes?: string[],
  /** When true, the normal fetch-on-filter-change is paused (AI search overrides results). */
  aiSearchActive = false,
): UseGalleryQueryReturn {
  const [items, setItems] = useState<PersonaDesignReview[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearchRaw] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [connectorFilter, setConnectorFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [coverageFilter, setCoverageFilter] = useState('all');
  const [availableConnectors, setAvailableConnectors] = useState<ConnectorWithCount[]>([]);
  const [availableCategories, setAvailableCategories] = useState<CategoryWithCount[]>([]);
  const [trendingTemplates, setTrendingTemplates] = useState<PersonaDesignReview[]>([]);
  const [readyTemplates, setReadyTemplates] = useState<PersonaDesignReview[]>([]);
  const [recommendedTemplates, setRecommendedTemplates] = useState<PersonaDesignReview[]>([]);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);
  const currentPageRef = useRef(0);

  const setSearch = useCallback((value: string) => {
    setSearchRaw(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(value);
    }, DEBOUNCE_MS);
  }, []);

  // Consume tour search prefill (reactive: tour sets value, gallery picks it up once)
  const tourSearchPrefill = usePersonaStore((s) => s.tourSearchPrefill);
  useEffect(() => {
    if (tourSearchPrefill) {
      setSearchRaw(tourSearchPrefill);
      setDebouncedSearch(tourSearchPrefill);
      usePersonaStore.getState().consumeTourSearchPrefill();
    }
  }, [tourSearchPrefill]);

  const fetchPage = useCallback(async (pageNum: number, append: boolean) => {
    const id = ++fetchIdRef.current;
    if (pageNum === 0) setIsLoading(true);
    else setIsFetchingMore(true);

    try {
      // 'readiness' is computed client-side; fall back to 'trending' for backend fetch
      const effectiveSortBy = sortBy === 'readiness' ? 'trending' : sortBy;
      const effectiveSortDir = sortBy === 'readiness' ? 'desc' : sortDir;
      const result: PaginatedReviewsResult = await listDesignReviewsPaginated({
        search: debouncedSearch || undefined,
        connectorFilter: connectorFilter.length > 0 ? connectorFilter : undefined,
        categoryFilter: categoryFilter.length > 0 ? categoryFilter : undefined,
        sortBy: effectiveSortBy,
        sortDir: effectiveSortDir,
        page: pageNum,
        perPage: PER_PAGE,
        coverageFilter: coverageFilter !== 'all' ? coverageFilter : undefined,
        coverageServiceTypes: coverageFilter !== 'all' && coverageServiceTypes ? coverageServiceTypes : undefined,
      });
      if (id !== fetchIdRef.current) return;
      setTotal(result.total);
      setItems(prev => append ? [...prev, ...result.items] : result.items);
    } catch (err) {
      console.error('Failed to fetch paginated reviews:', err);
    } finally {
      if (id === fetchIdRef.current) {
        setIsLoading(false);
        setIsFetchingMore(false);
      }
    }
  }, [debouncedSearch, connectorFilter, categoryFilter, sortBy, sortDir, coverageFilter, coverageServiceTypes]);

  // Reset and fetch page 0 when filters/search/sort change (only when AI not active)
  useEffect(() => {
    if (!aiSearchActive) {
      currentPageRef.current = 0;
      fetchPage(0, false);
    }
  }, [fetchPage, aiSearchActive]);

  // Fetch more: load the next page and append
  const fetchMore = useCallback(() => {
    if (isFetchingMore || isLoading || aiSearchActive) return;
    if (items.length >= total) return;
    const nextPage = currentPageRef.current + 1;
    currentPageRef.current = nextPage;
    fetchPage(nextPage, true);
  }, [isFetchingMore, isLoading, aiSearchActive, items.length, total, fetchPage]);

  const hasMore = items.length < total;

  // Fetch available connectors, categories, and trending templates.
  useEffect(() => {
    let cancelled = false;

    backfillReviewCategories().catch(() => {});
    listReviewConnectors()
      .then((data) => { if (!cancelled) setAvailableConnectors(data); })
      .catch(() => {});
    listReviewCategories()
      .then((data) => { if (!cancelled) setAvailableCategories(data); })
      .catch(() => {});
    getTrendingTemplates(8)
      .then((data) => { if (!cancelled) setTrendingTemplates(data); })
      .catch(() => {});

    if (coverageServiceTypes && coverageServiceTypes.length > 0) {
      listDesignReviewsPaginated({
        sortBy: 'trending',
        sortDir: 'desc',
        page: 0,
        perPage: 6,
        coverageFilter: 'full',
        coverageServiceTypes,
      })
        .then((r) => { if (!cancelled) setReadyTemplates(r.items); })
        .catch(() => {});

      listDesignReviewsPaginated({
        sortBy: 'trending',
        sortDir: 'desc',
        page: 0,
        perPage: 30,
        coverageFilter: 'partial',
        coverageServiceTypes,
      })
        .then((r) => {
          if (!cancelled) {
            const scored = scoreRecommendations(r.items, coverageServiceTypes);
            setRecommendedTemplates(scored);
          }
        })
        .catch(() => {});
    }

    return () => { cancelled = true; };
  }, [coverageServiceTypes]);

  const refresh = useCallback(() => {
    if (aiSearchActive) return;
    currentPageRef.current = 0;
    fetchPage(0, false);
    listReviewConnectors()
      .then(setAvailableConnectors)
      .catch(() => {});
    listReviewCategories()
      .then(setAvailableCategories)
      .catch(() => {});
    getTrendingTemplates(8)
      .then(setTrendingTemplates)
      .catch(() => {});
  }, [fetchPage, aiSearchActive]);

  return {
    items,
    total,
    hasMore,
    isFetchingMore,
    fetchMore,
    search,
    setSearch,
    debouncedSearch,
    connectorFilter,
    setConnectorFilter,
    categoryFilter,
    setCategoryFilter,
    sortBy,
    setSortBy,
    sortDir,
    setSortDir,
    coverageFilter,
    setCoverageFilter,
    isLoading,
    refresh,
    availableConnectors,
    availableCategories,
    trendingTemplates,
    readyTemplates,
    recommendedTemplates,
    setItems,
    setTotal,
    fetchPage,
  };
}
