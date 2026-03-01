import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  listDesignReviewsPaginated,
  listReviewConnectors,
  listReviewCategories,
  getTrendingTemplates,
  backfillReviewCategories,
  type PaginatedReviewsResult,
  type ConnectorWithCount,
  type CategoryWithCount,
} from '@/api/reviews';
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

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  const setSearch = useCallback((value: string) => {
    setSearchRaw(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(0);
    }, DEBOUNCE_MS);
  }, []);

  // Reset page on filter/sort change
  useEffect(() => {
    setPage(0);
  }, [connectorFilter, categoryFilter, sortBy, sortDir, coverageFilter]);

  // Fetch paginated reviews
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

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

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

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PER_PAGE)), [total]);

  const refresh = useCallback(() => {
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
  }, [fetchReviews]);

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
  };
}
