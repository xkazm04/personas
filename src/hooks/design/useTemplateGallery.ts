import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  listDesignReviewsPaginated,
  listReviewConnectors,
  type PaginatedReviewsResult,
  type ConnectorWithCount,
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
  sortBy: string;
  setSortBy: (s: string) => void;
  sortDir: string;
  setSortDir: (d: string) => void;
  setPage: (p: number) => void;
  isLoading: boolean;
  refresh: () => void;
  availableConnectors: ConnectorWithCount[];
}

const PER_PAGE = 10;
const DEBOUNCE_MS = 300;

export function useTemplateGallery(): UseTemplateGalleryReturn {
  const [items, setItems] = useState<PersonaDesignReview[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearchRaw] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [connectorFilter, setConnectorFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [isLoading, setIsLoading] = useState(false);
  const [availableConnectors, setAvailableConnectors] = useState<ConnectorWithCount[]>([]);

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
  }, [connectorFilter, sortBy, sortDir]);

  // Fetch paginated reviews
  const fetchIdRef = useRef(0);
  const fetchReviews = useCallback(async () => {
    const id = ++fetchIdRef.current;
    setIsLoading(true);
    try {
      const result: PaginatedReviewsResult = await listDesignReviewsPaginated({
        search: debouncedSearch || undefined,
        connectorFilter: connectorFilter.length > 0 ? connectorFilter : undefined,
        sortBy,
        sortDir,
        page,
        perPage: PER_PAGE,
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
  }, [debouncedSearch, connectorFilter, sortBy, sortDir, page]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  // Fetch available connectors once
  useEffect(() => {
    listReviewConnectors()
      .then(setAvailableConnectors)
      .catch(() => {});
  }, []);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PER_PAGE)), [total]);

  const refresh = useCallback(() => {
    fetchReviews();
    listReviewConnectors()
      .then(setAvailableConnectors)
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
    sortBy,
    setSortBy,
    sortDir,
    setSortDir,
    setPage,
    isLoading,
    refresh,
    availableConnectors,
  };
}
