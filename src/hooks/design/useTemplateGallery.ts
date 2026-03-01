import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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
  items: PersonaDesignReview[];
  total: number;
  page: number;
  totalPages: number;
  perPage: number;
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
  setPage: (p: number) => void;
  isLoading: boolean;
  refresh: () => void;
  availableConnectors: ConnectorWithCount[];
  availableCategories: CategoryWithCount[];
  trendingTemplates: PersonaDesignReview[];
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

const PER_PAGE = 10;
const DEBOUNCE_MS = 300;

export function useTemplateGallery(coverageServiceTypes?: string[]): UseTemplateGalleryReturn {
  const [items, setItems] = useState<PersonaDesignReview[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearchRaw] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [connectorFilter, setConnectorFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [isLoading, setIsLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [availableConnectors, setAvailableConnectors] = useState<ConnectorWithCount[]>([]);
  const [availableCategories, setAvailableCategories] = useState<CategoryWithCount[]>([]);
  const [trendingTemplates, setTrendingTemplates] = useState<PersonaDesignReview[]>([]);
  const [coverageFilter, setCoverageFilter] = useState('all');

  // AI search state
  const [aiSearchMode, setAiSearchMode] = useState(false);
  const [aiSearchLoading, setAiSearchLoading] = useState(false);
  const [aiSearchRationale, setAiSearchRationale] = useState('');
  // When true, AI results are currently displayed (suppress keyword fetch)
  const [aiSearchActive, setAiSearchActive] = useState(false);
  const [aiCliLog, setAiCliLog] = useState<string[]>([]);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiSearchIdRef = useRef(0);

  // In AI mode: no debounce, just update the raw value.
  // In keyword mode: debounce as before.
  const setSearch = useCallback((value: string) => {
    setSearchRaw(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    // In AI mode, don't trigger keyword search on typing.
    // Also, if AI results are active and user clears, reset to keyword.
    if (aiSearchMode) {
      if (!value.trim()) {
        setAiSearchActive(false);
        setAiSearchRationale('');
        setDebouncedSearch('');
        setPage(0);
      }
      return;
    }

    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(0);
    }, DEBOUNCE_MS);
  }, [aiSearchMode]);

  // Reset page on filter/sort change
  useEffect(() => {
    setPage(0);
  }, [connectorFilter, categoryFilter, sortBy, sortDir, coverageFilter]);

  // Fetch paginated reviews — only runs when NOT showing AI results
  const fetchIdRef = useRef(0);
  const fetchReviews = useCallback(async () => {
    const id = ++fetchIdRef.current;
    setIsLoading(true);
    try {
      const result: PaginatedReviewsResult = await listDesignReviewsPaginated({
        search: debouncedSearch || undefined,
        connectorFilter: connectorFilter.length > 0 ? connectorFilter : undefined,
        categoryFilter: categoryFilter.length > 0 ? categoryFilter : undefined,
        sortBy,
        sortDir,
        page,
        perPage: PER_PAGE,
        coverageFilter: coverageFilter !== 'all' ? coverageFilter : undefined,
        coverageServiceTypes: coverageFilter !== 'all' && coverageServiceTypes ? coverageServiceTypes : undefined,
      });
      if (id === fetchIdRef.current) {
        setItems(result.items);
        setTotal(result.total);
      }
    } catch (err) {
      console.error('Failed to fetch paginated reviews:', err);
    } finally {
      if (id === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [debouncedSearch, connectorFilter, categoryFilter, sortBy, sortDir, page, coverageFilter, coverageServiceTypes]);

  // Only run keyword fetch when AI results are NOT active
  useEffect(() => {
    if (!aiSearchActive) {
      fetchReviews();
    }
  }, [fetchReviews, aiSearchActive]);

  // Fetch available connectors and trending templates once.
  // Also run a one-shot backfill for any reviews missing a category.
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
  }, []);

  // AI search: fire-and-forget background call, update UI when result arrives
  const triggerAiSearch = useCallback((query: string) => {
    if (!query.trim() || query.trim().length < 5) return;

    const searchId = ++aiSearchIdRef.current;
    setAiSearchLoading(true);
    setAiSearchRationale('');
    setAiCliLog([]);

    // Run in background — don't block
    (async () => {
      try {
        const result = await smartSearchTemplates(query.trim());

        // Stale check: if another search was triggered, discard this result
        if (searchId !== aiSearchIdRef.current) return;

        // Capture CLI log for debugging display
        if (result.cliLog?.length) {
          setAiCliLog(result.cliLog);
        }

        if (result.rankedIds.length === 0) {
          setAiSearchRationale(result.rationale || 'No matching templates found.');
          setItems([]);
          setTotal(0);
          setAiSearchActive(true);
          setAiSearchLoading(false);
          return;
        }

        // Fetch each review by ID, preserve ranked order
        const reviews = await Promise.all(
          result.rankedIds.map((id) =>
            getDesignReview(id).catch(() => null),
          ),
        );

        // Stale check again
        if (searchId !== aiSearchIdRef.current) return;

        const ordered = reviews.filter((r): r is PersonaDesignReview => r !== null);
        setItems(ordered);
        setTotal(ordered.length);
        setAiSearchActive(true);
        setAiSearchRationale(result.rationale);
      } catch (err: unknown) {
        if (searchId !== aiSearchIdRef.current) return;
        console.warn('AI search failed, falling back to keyword search:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        setAiSearchRationale(`AI search failed: ${errMsg}`);
        setAiSearchActive(false);
        // Let the normal keyword fetch run
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

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PER_PAGE)), [total]);

  const refresh = useCallback(() => {
    if (aiSearchActive) return;
    fetchReviews();
    listReviewConnectors()
      .then(setAvailableConnectors)
      .catch(() => {});
    listReviewCategories()
      .then(setAvailableCategories)
      .catch(() => {});
    getTrendingTemplates(8)
      .then(setTrendingTemplates)
      .catch(() => {});
  }, [fetchReviews, aiSearchActive]);

  return {
    items,
    total,
    page,
    totalPages,
    perPage: PER_PAGE,
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
    setPage,
    isLoading,
    refresh,
    availableConnectors,
    availableCategories,
    trendingTemplates,
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
