import { useState, useCallback, useEffect, useRef } from 'react';
import {
  listDesignReviewsPaginated,
  listReviewConnectors,
  listReviewCategories,
  getTrendingTemplates,
  getDesignReview,
  backfillReviewCategories,
  type PaginatedReviewsResult,
  type ConnectorWithCount,
  type CategoryWithCount,
} from '@/api/reviews';
import { smartSearchTemplates } from '@/api/smartSearch';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

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

const PER_PAGE = 50;
const DEBOUNCE_MS = 150;

export function useTemplateGallery(coverageServiceTypes?: string[]): UseTemplateGalleryReturn {
  const [allItems, setAllItems] = useState<PersonaDesignReview[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearchRaw] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [connectorFilter, setConnectorFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [availableConnectors, setAvailableConnectors] = useState<ConnectorWithCount[]>([]);
  const [availableCategories, setAvailableCategories] = useState<CategoryWithCount[]>([]);
  const [trendingTemplates, setTrendingTemplates] = useState<PersonaDesignReview[]>([]);
  const [readyTemplates, setReadyTemplates] = useState<PersonaDesignReview[]>([]);
  const [coverageFilter, setCoverageFilter] = useState('all');

  // AI search state
  const [aiSearchMode, setAiSearchMode] = useState(false);
  const [aiSearchLoading, setAiSearchLoading] = useState(false);
  const [aiSearchRationale, setAiSearchRationale] = useState('');
  const [aiSearchActive, setAiSearchActive] = useState(false);
  const [aiCliLog, setAiCliLog] = useState<string[]>([]);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiSearchIdRef = useRef(0);
  const fetchIdRef = useRef(0);
  const currentPageRef = useRef(0);

  // In AI mode: no debounce. In keyword mode: debounce as before.
  const setSearch = useCallback((value: string) => {
    setSearchRaw(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (aiSearchMode) {
      if (!value.trim()) {
        setAiSearchActive(false);
        setAiSearchRationale('');
        setDebouncedSearch('');
      }
      return;
    }

    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(value);
    }, DEBOUNCE_MS);
  }, [aiSearchMode]);

  // Fetch a specific page, optionally appending to existing items
  const fetchPage = useCallback(async (pageNum: number, append: boolean) => {
    const id = ++fetchIdRef.current;
    if (pageNum === 0) setIsLoading(true);
    else setIsFetchingMore(true);

    try {
      const result: PaginatedReviewsResult = await listDesignReviewsPaginated({
        search: debouncedSearch || undefined,
        connectorFilter: connectorFilter.length > 0 ? connectorFilter : undefined,
        categoryFilter: categoryFilter.length > 0 ? categoryFilter : undefined,
        sortBy,
        sortDir,
        page: pageNum,
        perPage: PER_PAGE,
        coverageFilter: coverageFilter !== 'all' ? coverageFilter : undefined,
        coverageServiceTypes: coverageFilter !== 'all' && coverageServiceTypes ? coverageServiceTypes : undefined,
      });
      if (id !== fetchIdRef.current) return;
      setTotal(result.total);
      setAllItems(prev => append ? [...prev, ...result.items] : result.items);
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
  }, [fetchPage, aiSearchActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch more: load the next page and append
  const fetchMore = useCallback(() => {
    if (isFetchingMore || isLoading || aiSearchActive) return;
    if (allItems.length >= total) return;
    const nextPage = currentPageRef.current + 1;
    currentPageRef.current = nextPage;
    fetchPage(nextPage, true);
  }, [isFetchingMore, isLoading, aiSearchActive, allItems.length, total, fetchPage]);

  const hasMore = allItems.length < total;

  // Fetch available connectors, categories, and trending templates once.
  useEffect(() => {
    backfillReviewCategories().catch(() => {});
    listReviewConnectors()
      .then(setAvailableConnectors)
      .catch(() => {});
    listReviewCategories()
      .then(setAvailableCategories)
      .catch(() => {});
    getTrendingTemplates(8)
      .then(setTrendingTemplates)
      .catch(() => {});
    // Fetch "ready to deploy" templates (top 6 with full coverage)
    if (coverageServiceTypes && coverageServiceTypes.length > 0) {
      listDesignReviewsPaginated({
        sortBy: 'trending',
        sortDir: 'desc',
        page: 0,
        perPage: 6,
        coverageFilter: 'full',
        coverageServiceTypes,
      })
        .then((r) => setReadyTemplates(r.items))
        .catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // AI search: fire-and-forget background call
  const triggerAiSearch = useCallback((query: string) => {
    if (!query.trim() || query.trim().length < 5) return;

    const searchId = ++aiSearchIdRef.current;
    setAiSearchLoading(true);
    setAiSearchRationale('');
    setAiCliLog([]);

    (async () => {
      try {
        const result = await smartSearchTemplates(query.trim());
        if (searchId !== aiSearchIdRef.current) return;

        if (result.cliLog?.length) {
          setAiCliLog(result.cliLog);
        }

        if (result.rankedIds.length === 0) {
          setAiSearchRationale(result.rationale || 'No matching templates found.');
          setAllItems([]);
          setTotal(0);
          setAiSearchActive(true);
          setAiSearchLoading(false);
          return;
        }

        const reviews = await Promise.all(
          result.rankedIds.map((id) =>
            getDesignReview(id).catch(() => null),
          ),
        );

        if (searchId !== aiSearchIdRef.current) return;

        const ordered = reviews.filter((r): r is PersonaDesignReview => r !== null);
        setAllItems(ordered);
        setTotal(ordered.length);
        setAiSearchActive(true);
        setAiSearchRationale(result.rationale);
      } catch (err: unknown) {
        if (searchId !== aiSearchIdRef.current) return;
        console.warn('AI search failed, falling back to keyword search:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        setAiSearchRationale(`AI search failed: ${errMsg}`);
        setAiSearchActive(false);
      } finally {
        if (searchId === aiSearchIdRef.current) {
          setAiSearchLoading(false);
        }
      }
    })();
  }, []);

  const clearAiSearch = useCallback(() => {
    aiSearchIdRef.current++;
    setAiSearchActive(false);
    setAiSearchRationale('');
    setAiSearchLoading(false);
    setAiCliLog([]);
  }, []);

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
    allItems,
    total,
    hasMore,
    isFetchingMore,
    fetchMore,
    search,
    setSearch,
    connectorFilter,
    setConnectorFilter,
    categoryFilter,
    setCategoryFilter,
    sortBy,
    setSortBy,
    sortDir,
    setSortDir,
    isLoading,
    refresh,
    availableConnectors,
    availableCategories,
    trendingTemplates,
    readyTemplates,
    coverageFilter,
    setCoverageFilter,
    // AI search
    aiSearchMode,
    setAiSearchMode,
    aiSearchLoading,
    aiSearchRationale,
    aiSearchActive,
    triggerAiSearch,
    clearAiSearch,
    aiCliLog,
  };
}
