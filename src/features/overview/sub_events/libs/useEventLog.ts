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

const INITIAL_LIMIT = 50;
const LOAD_MORE_LIMIT = 50;
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
  const searchAbortRef = useRef<AbortController | null>(null);

  // Cursor-based "load older" pagination — fetched on-demand via search_events
  // with `until` cursor. Lives alongside recentEvents/serverResults.
  const [olderEvents, setOlderEvents] = useState<PersonaEvent[]>([]);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

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
        await fetchRecentEvents(INITIAL_LIMIT);
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
    // The 'event-bus' channel multiplexes full PersonaEvent payloads (CDC INSERT
    // + manual emit_event_to_frontend) AND lightweight CDC notifications
    // ({action,table,rowid}) for UPDATE/DELETE. Reject the latter — they have
    // no id/event_type and corrupt the events list.
    if (!evt?.id || !evt?.event_type) return;
    pushRecentEvent(evt, 200);
  }, [pushRecentEvent]);
  useEventBusListener(handleBusEvent);

  // Server-side search with debounce
  const executeSearch = useCallback(async () => {
    // Abort any in-flight search to prevent stale results from overwriting
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

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
      // Discard results if a newer search was started while we were waiting
      if (controller.signal.aborted) return;
      setServerResults(result.events);
      setServerHasMore(result.has_more);
    } catch (err) {
      if (controller.signal.aborted) return;
      logger.error('Event search failed', { error: err });
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
    }
  }, [statusFilter, typeFilter, selectedPersonaId, searchText]);

  // Debounced search trigger
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    const hasFilters = statusFilter !== 'all' || typeFilter !== 'all' || selectedPersonaId || searchText.trim();
    if (!hasFilters) {
      setServerResults([]);
      setServerHasMore(false);
      setIsSearching(false);
      return;
    }

    // Set searching immediately so filteredEvents doesn't flash empty
    // while the debounced/deferred executeSearch is still pending.
    setIsSearching(true);

    searchTimerRef.current = setTimeout(() => {
      executeSearch();
    }, searchText.trim() ? 300 : 0); // Debounce text search, instant for dropdown filters

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchAbortRef.current?.abort();
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

  // Use server results when filters are active, otherwise client-side filter.
  // In both modes, merged with older events fetched via loadOlder.
  const filteredEvents = useMemo(() => {
    const hasFilters = statusFilter !== 'all' || typeFilter !== 'all' || selectedPersonaId || searchText.trim();

    let base: PersonaEvent[];
    if (hasFilters) {
      if (serverResults.length === 0 && !isSearching) return [];
      base = serverResults;
    } else {
      base = recentEvents;
    }

    // Dedupe-merge with on-demand older events
    const seen = new Set<string>();
    const merged: PersonaEvent[] = [];
    for (const e of base) {
      if (!seen.has(e.id)) { seen.add(e.id); merged.push(e); }
    }
    for (const e of olderEvents) {
      if (!seen.has(e.id)) { seen.add(e.id); merged.push(e); }
    }

    // Sort by created_at
    const tsMap = new Map<string, number>();
    for (const e of merged) {
      tsMap.set(e.id, new Date(e.created_at).getTime());
    }
    merged.sort((a, b) => {
      const ta = tsMap.get(a.id)!;
      const tb = tsMap.get(b.id)!;
      return sortDirection === 'desc' ? tb - ta : ta - tb;
    });
    return merged;
  }, [recentEvents, serverResults, olderEvents, statusFilter, typeFilter, selectedPersonaId, searchText, sortDirection, isSearching]);

  // Reset older-events cursor when filters change — they'd reference stale criteria.
  useEffect(() => {
    setOlderEvents([]);
    setHasMoreOlder(true);
  }, [statusFilter, typeFilter, selectedPersonaId, searchText]);

  // Load events older than the current oldest displayed event using `until` cursor.
  const loadOlder = useCallback(async () => {
    if (isLoadingOlder || !hasMoreOlder) return;
    if (filteredEvents.length === 0) return;

    // Pick the chronologically oldest event regardless of sort direction.
    let oldest = filteredEvents[0]!;
    for (const e of filteredEvents) {
      if (e.created_at < oldest.created_at) oldest = e;
    }

    setIsLoadingOlder(true);
    try {
      const filter: EventFilterInput = {
        until: oldest.created_at,
        limit: LOAD_MORE_LIMIT,
      };
      if (statusFilter !== 'all') filter.status = statusFilter;
      if (typeFilter !== 'all') filter.eventType = typeFilter;
      if (selectedPersonaId) filter.targetPersonaId = selectedPersonaId;
      if (searchText.trim()) filter.search = searchText.trim();

      const result = await searchEvents(filter);
      const existing = new Set([
        ...recentEvents.map((e) => e.id),
        ...serverResults.map((e) => e.id),
        ...olderEvents.map((e) => e.id),
      ]);
      const newOnes = result.events.filter(
        (e) => !existing.has(e.id) && e.created_at < oldest.created_at,
      );

      if (newOnes.length === 0) {
        setHasMoreOlder(false);
      } else {
        setOlderEvents((prev) => [...prev, ...newOnes]);
        setHasMoreOlder(result.has_more);
      }
    } catch (err) {
      logger.error('loadOlder failed', { error: err });
    } finally {
      setIsLoadingOlder(false);
    }
  }, [filteredEvents, isLoadingOlder, hasMoreOlder, statusFilter, typeFilter, selectedPersonaId, searchText, recentEvents, serverResults, olderEvents]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setOlderEvents([]);
    setHasMoreOlder(true);
    try {
      await fetchRecentEvents(INITIAL_LIMIT);
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
    setOlderEvents([]);
    setHasMoreOlder(true);
  };

  return {
    recentEvents, pendingEventCount, personas, availableTypes,
    statusFilter, setStatusFilter, typeFilter, setTypeFilter,
    sortDirection, toggleSortDirection,
    selectedEvent, setSelectedEvent,
    selectedPersonaId, setSelectedPersonaId: setPersonaId,
    isLoading, isRefreshing, isSearching,
    filteredEvents,
    handleRefresh, getPersona,
    // Search
    searchText, setSearchText, serverHasMore,
    // Cursor pagination
    loadOlder, hasMoreOlder, isLoadingOlder,
    // Saved views
    savedViews, activeViewId, saveCurrentView, applySavedView, removeSavedView, clearFilters,
  };
}
