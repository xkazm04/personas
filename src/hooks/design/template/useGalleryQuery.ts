import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createLogger } from '@/lib/log';

const logger = createLogger('gallery-query');
import { useSystemStore } from "@/stores/systemStore";
import { silentCatch } from "@/lib/silentCatch";
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
  unfilteredTotal: number;
  setItems: React.Dispatch<React.SetStateAction<PersonaDesignReview[]>>;
  setTotal: React.Dispatch<React.SetStateAction<number>>;
  fetchPage: (pageNum: number, append: boolean) => Promise<void>;
}

const DEFAULT_PER_PAGE = 50;
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
  perPage = DEFAULT_PER_PAGE,
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
  const [unfilteredTotal, setUnfilteredTotal] = useState(0);

  // Stabilize coverageServiceTypes by content so a new array reference with
  // identical elements doesn't re-trigger the heavy mount effect (6+ API calls).
  const stableCoverageServiceTypes = useMemo(
    () => coverageServiceTypes,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coverageServiceTypes?.join('\0')],
  );

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);
  const currentPageRef = useRef(0);
  /** Synchronous guard — prevents concurrent fetchMore calls from racing. */
  const fetchMoreLockRef = useRef(false);
  /** Set to true when a fetchMore was requested while another was in-flight. */
  const fetchMoreQueuedRef = useRef(false);

  const setSearch = useCallback((value: string) => {
    setSearchRaw(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(value);
    }, DEBOUNCE_MS);
  }, []);

  // Consume tour search prefill (reactive: tour sets value, gallery picks it up once)
  const tourSearchPrefill = useSystemStore((s) => s.tourSearchPrefill);
  useEffect(() => {
    if (tourSearchPrefill) {
      setSearchRaw(tourSearchPrefill);
      setDebouncedSearch(tourSearchPrefill);
      useSystemStore.getState().consumeTourSearchPrefill();
    }
  }, [tourSearchPrefill]);

  const fetchPage = useCallback(async (pageNum: number, append: boolean) => {
    const id = ++fetchIdRef.current;
    if (pageNum === 0) setIsLoading(true);

    try {
      // 'readiness' is computed client-side; fall back to 'trending' for backend fetch
      const effectiveSortBy = sortBy === 'readiness' ? 'trending' : sortBy;
      const effectiveSortDir = sortBy === 'readiness' ? 'desc' : sortDir;
      // Coverage filtering is applied client-side (in useGalleryActions) so it uses
      // the same category-level readiness logic as the filter counts.
      const hasFilters = !!(debouncedSearch || connectorFilter.length > 0 || categoryFilter.length > 0);
      const result: PaginatedReviewsResult = await listDesignReviewsPaginated({
        search: debouncedSearch || undefined,
        connectorFilter: connectorFilter.length > 0 ? connectorFilter : undefined,
        categoryFilter: categoryFilter.length > 0 ? categoryFilter : undefined,
        sortBy: effectiveSortBy,
        sortDir: effectiveSortDir,
        page: pageNum,
        perPage,
      });
      if (id !== fetchIdRef.current) return;
      setTotal(result.total);
      // When fetching page 0 with no filters, the total is the unfiltered count —
      // reuse it instead of making a separate request.
      if (pageNum === 0 && !hasFilters) {
        setUnfilteredTotal(result.total);
      }
      setItems(prev => append ? [...prev, ...result.items] : result.items);
    } catch (err) {
      logger.error('Failed to fetch paginated reviews', { err });
    } finally {
      if (id === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [debouncedSearch, connectorFilter, categoryFilter, sortBy, sortDir, perPage]);

  // Reset and fetch page 0 when filters/search/sort change (only when AI not active)
  useEffect(() => {
    if (!aiSearchActive) {
      currentPageRef.current = 0;
      fetchMoreLockRef.current = false;
      fetchMoreQueuedRef.current = false;
      fetchPage(0, false);
    }
  }, [fetchPage, aiSearchActive]);

  // Fetch more: load the next page and append.
  // Uses a synchronous ref lock to prevent concurrent fetches from racing.
  // If called while a fetch is in-flight, the request is queued and runs after
  // the current fetch completes — this guarantees pages arrive in order.
  const fetchMore = useCallback(() => {
    if (isLoading || aiSearchActive) return;
    if (items.length >= total) return;

    if (fetchMoreLockRef.current) {
      fetchMoreQueuedRef.current = true;
      return;
    }

    fetchMoreLockRef.current = true;
    fetchMoreQueuedRef.current = false;

    const nextPage = currentPageRef.current + 1;
    currentPageRef.current = nextPage;

    setIsFetchingMore(true);
    fetchPage(nextPage, true).finally(() => {
      fetchMoreLockRef.current = false;
      setIsFetchingMore(false);

      // If another fetchMore was requested while we were fetching, drain the queue
      if (fetchMoreQueuedRef.current) {
        fetchMoreQueuedRef.current = false;
        // Re-check conditions before recursing
        fetchMore();
      }
    });
  }, [isLoading, aiSearchActive, items.length, total, fetchPage]);

  const hasMore = items.length < total;

  // Fetch available connectors, categories, and trending templates.
  useEffect(() => {
    let cancelled = false;

    backfillReviewCategories().catch(silentCatch("galleryQuery:backfillCategories"));
    listReviewConnectors()
      .then((data) => { if (!cancelled) setAvailableConnectors(data); })
      .catch(silentCatch("galleryQuery:listConnectors"));
    listReviewCategories()
      .then((data) => { if (!cancelled) setAvailableCategories(data); })
      .catch(silentCatch("galleryQuery:listCategories"));
    getTrendingTemplates(5)
      .then((data) => { if (!cancelled) setTrendingTemplates(data); })
      .catch(silentCatch("galleryQuery:getTrending"));

    // unfilteredTotal is now derived from the initial fetchPage(0) call which runs
    // on mount with no filters active — no separate request needed here.

    if (stableCoverageServiceTypes && stableCoverageServiceTypes.length > 0) {
      listDesignReviewsPaginated({
        sortBy: 'trending',
        sortDir: 'desc',
        page: 0,
        perPage: 6,
        coverageFilter: 'full',
        coverageServiceTypes: stableCoverageServiceTypes,
      })
        .then((r) => { if (!cancelled) setReadyTemplates(r.items); })
        .catch(silentCatch("galleryQuery:readyTemplates"));

      listDesignReviewsPaginated({
        sortBy: 'trending',
        sortDir: 'desc',
        page: 0,
        perPage: 30,
        coverageFilter: 'partial',
        coverageServiceTypes: stableCoverageServiceTypes,
      })
        .then((r) => {
          if (!cancelled) {
            const scored = scoreRecommendations(r.items, stableCoverageServiceTypes);
            setRecommendedTemplates(scored);
          }
        })
        .catch(silentCatch("galleryQuery:recommendedTemplates"));
    }

    return () => { cancelled = true; };
  }, [stableCoverageServiceTypes]);

  const refresh = useCallback(() => {
    if (aiSearchActive) return;
    currentPageRef.current = 0;
    fetchPage(0, false);
    listReviewConnectors()
      .then(setAvailableConnectors)
      .catch(silentCatch("galleryQuery:refreshConnectors"));
    listReviewCategories()
      .then(setAvailableCategories)
      .catch(silentCatch("galleryQuery:refreshCategories"));
    getTrendingTemplates(5)
      .then(setTrendingTemplates)
      .catch(silentCatch("galleryQuery:refreshTrending"));
    // fetchPage already sets unfilteredTotal when no filters are active.
    // Only make a separate call when filters are applied so the "All" count stays fresh.
    const hasFilters = !!(debouncedSearch || connectorFilter.length > 0 || categoryFilter.length > 0);
    if (hasFilters) {
      listDesignReviewsPaginated({ page: 0, perPage: 1 })
        .then((r) => setUnfilteredTotal(r.total))
        .catch(silentCatch("galleryQuery:refreshUnfilteredTotal"));
    }
  }, [fetchPage, aiSearchActive, debouncedSearch, connectorFilter, categoryFilter]);

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
    unfilteredTotal,
    setItems,
    setTotal,
    fetchPage,
  };
}
