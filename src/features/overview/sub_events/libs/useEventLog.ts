import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from "@/stores/agentStore";
import { useEventBusListener } from '@/hooks/realtime/useEventBusListener';
import { useOverviewFilterValues, useOverviewFilterActions } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { searchEvents } from '@/api/overview/events';
import { listSavedViewsByType, createSavedView, deleteSavedView } from '@/api/overview/savedViews';
import type { SavedView } from '@/lib/bindings/SavedView';
import type { EventFilterInput } from '@/lib/bindings/EventFilterInput';
import type { PersonaEvent } from '@/lib/types/types';
import { createLogger } from '@/lib/log';

const logger = createLogger('event-log');

export type SortDirection = 'desc' | 'asc';

const PAGE_SIZE = 20;
const SAVED_VIEW_TYPE = 'event_log';

export interface EventSearchState {
  searchText: string;
  isServerSearch: boolean;
  serverResults: PersonaEvent[];
  serverHasMore: boolean;
}

export function useEventLog() {
  const {
    recentEvents, pendingEventCount, fetchRecentEvents, pushRecentEvent,
  } = useOverviewStore(useShallow((s) => ({
    recentEvents: s.recentEvents,
    pendingEventCount: s.pendingEventCount,
    fetchRecentEvents: s.fetchRecentEvents,
    pushRecentEvent: s.pushRecentEvent,
  })));
  const personas = useAgentStore((s) => s.personas);

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);
  const [selectedEvent, setSelectedEvent] = useState<PersonaEvent | null>(null);
  const { selectedPersonaId } = useOverviewFilterValues();
  const { setSelectedPersonaId: setPersonaId } = useOverviewFilterActions();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Search state
  const [searchText, setSearchText] = useState('');
  const [serverResults, setServerResults] = useState<PersonaEvent[]>([]);
  const [serverHasMore, setServerHasMore] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Saved views state
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  // Determine if we're in server-search mode
  const isServerSearch = searchText.trim().length > 0 || (
    statusFilter !== 'all' || typeFilter !== 'all' || selectedPersonaId
  );

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      try {
        await fetchRecentEvents(100);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [fetchRecentEvents]);

  // Load saved views
  useEffect(() => {
    listSavedViewsByType(SAVED_VIEW_TYPE)
      .then(setSavedViews)
      .catch((err) => logger.warn('Failed to load saved views', { error: err }));
  }, []);

  const handleBusEvent = useCallback((evt: PersonaEvent) => {
    pushRecentEvent(evt, 200);
  }, [pushRecentEvent]);
  useEventBusListener(handleBusEvent);

  // Server-side search with debounce
  const executeSearch = useCallback(async () => {
    const filter: EventFilterInput = { limit: 200 };

    if (statusFilter !== 'all') filter.status = statusFilter;
    if (typeFilter !== 'all') filter.eventType = typeFilter;
    if (selectedPersonaId) filter.targetPersonaId = selectedPersonaId;
    if (searchText.trim()) filter.search = searchText.trim();

    // Only run server search if we actually have filters
    const hasFilters = filter.status || filter.eventType || filter.targetPersonaId || filter.search;
    if (!hasFilters) {
      setServerResults([]);
      setServerHasMore(false);
      return;
    }

    setIsSearching(true);
    try {
      const result = await searchEvents(filter);
      setServerResults(result.events);
      setServerHasMore(result.has_more);
    } catch (err) {
      logger.error('Event search failed', { error: err });
    } finally {
      setIsSearching(false);
    }
  }, [statusFilter, typeFilter, selectedPersonaId, searchText]);

  // Debounced search trigger
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    const hasFilters = statusFilter !== 'all' || typeFilter !== 'all' || selectedPersonaId || searchText.trim();
    if (!hasFilters) {
      setServerResults([]);
      setServerHasMore(false);
      return;
    }

    searchTimerRef.current = setTimeout(() => {
      executeSearch();
    }, searchText.trim() ? 300 : 0); // Debounce text search, instant for dropdown filters

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [executeSearch, statusFilter, typeFilter, selectedPersonaId, searchText]);

  // Derive available event types from the data
  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    for (const e of recentEvents) {
      if (e.event_type) types.add(e.event_type);
    }
    return Array.from(types).sort();
  }, [recentEvents]);

  // Use server results when filters are active, otherwise client-side filter
  const filteredEvents = useMemo(() => {
    const hasFilters = statusFilter !== 'all' || typeFilter !== 'all' || selectedPersonaId || searchText.trim();
    if (hasFilters && serverResults.length > 0) {
      // Pre-compute timestamps to avoid repeated Date constructions in sort comparator
      const tsMap = new Map<string, number>();
      for (const e of serverResults) {
        tsMap.set(e.id, new Date(e.created_at).getTime());
      }
      const sorted = [...serverResults].sort((a, b) => {
        const ta = tsMap.get(a.id)!;
        const tb = tsMap.get(b.id)!;
        return sortDirection === 'desc' ? tb - ta : ta - tb;
      });
      return sorted;
    }

    if (hasFilters && !isSearching) {
      // Server returned 0 results
      return [];
    }

    // No filters active — use local events
    const tsMap = new Map<string, number>();
    for (const e of recentEvents) {
      tsMap.set(e.id, new Date(e.created_at).getTime());
    }
    const sorted = [...recentEvents].sort((a, b) => {
      const ta = tsMap.get(a.id)!;
      const tb = tsMap.get(b.id)!;
      return sortDirection === 'desc' ? tb - ta : ta - tb;
    });
    return sorted;
  }, [recentEvents, serverResults, statusFilter, typeFilter, selectedPersonaId, searchText, sortDirection, isSearching]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [statusFilter, typeFilter, selectedPersonaId, sortDirection, searchText]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE));
  const paginatedEvents = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredEvents.slice(start, start + PAGE_SIZE);
  }, [filteredEvents, page]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchRecentEvents(100);
      if (isServerSearch) await executeSearch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const getPersona = (id: string | null) => {
    if (!id) return null;
    return personas.find((persona) => persona.id === id) ?? null;
  };

  const toggleSortDirection = () => {
    setSortDirection((d) => (d === 'desc' ? 'asc' : 'desc'));
  };

  // Saved view operations
  const saveCurrentView = async (name: string) => {
    const config: Record<string, string> = {};
    if (statusFilter !== 'all') config.status = statusFilter;
    if (typeFilter !== 'all') config.eventType = typeFilter;
    if (selectedPersonaId) config.targetPersonaId = selectedPersonaId;
    if (searchText.trim()) config.search = searchText.trim();

    try {
      const view = await createSavedView({
        name,
        persona_id: selectedPersonaId || null,
        day_range: 30,
        custom_start_date: null,
        custom_end_date: null,
        compare_enabled: false,
        is_smart: false,
        view_type: SAVED_VIEW_TYPE,
        view_config: JSON.stringify(config),
      });
      setSavedViews((prev) => [view, ...prev]);
      setActiveViewId(view.id);
    } catch (err) {
      logger.error('Failed to save view', { error: err });
    }
  };

  const applySavedView = (view: SavedView) => {
    setActiveViewId(view.id);
    try {
      const config = view.view_config ? JSON.parse(view.view_config) : {};
      setStatusFilter(config.status || 'all');
      setTypeFilter(config.eventType || 'all');
      setPersonaId(config.targetPersonaId || '');
      setSearchText(config.search || '');
    } catch {
      logger.warn('Failed to parse saved view config', { viewId: view.id });
    }
  };

  const removeSavedView = async (viewId: string) => {
    try {
      await deleteSavedView(viewId);
      setSavedViews((prev) => prev.filter((v) => v.id !== viewId));
      if (activeViewId === viewId) setActiveViewId(null);
    } catch (err) {
      logger.error('Failed to delete saved view', { error: err });
    }
  };

  const clearFilters = () => {
    setStatusFilter('all');
    setTypeFilter('all');
    setPersonaId('');
    setSearchText('');
    setActiveViewId(null);
  };

  return {
    recentEvents, pendingEventCount, personas, availableTypes,
    statusFilter, setStatusFilter, typeFilter, setTypeFilter,
    sortDirection, toggleSortDirection,
    page, setPage, totalPages, pageSize: PAGE_SIZE,
    selectedEvent, setSelectedEvent,
    selectedPersonaId, setSelectedPersonaId: setPersonaId,
    isLoading, isRefreshing, isSearching,
    filteredEvents, paginatedEvents,
    handleRefresh, getPersona,
    // Search
    searchText, setSearchText, serverHasMore,
    // Saved views
    savedViews, activeViewId, saveCurrentView, applySavedView, removeSavedView, clearFilters,
  };
}
