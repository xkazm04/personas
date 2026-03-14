import { useEffect, useState, useCallback, useMemo } from 'react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useAgentStore } from "@/stores/agentStore";
import { useEventBusListener } from '@/hooks/realtime/useEventBusListener';
import { useOverviewFilterValues, useOverviewFilterActions } from '@/features/overview/components/dashboard/OverviewFilterContext';
import type { PersonaEvent } from '@/lib/types/types';

export type SortDirection = 'desc' | 'asc';

const PAGE_SIZE = 20;

export function useEventLog() {
  const recentEvents = useOverviewStore((s) => s.recentEvents);
  const pendingEventCount = useOverviewStore((s) => s.pendingEventCount);
  const fetchRecentEvents = useOverviewStore((s) => s.fetchRecentEvents);
  const pushRecentEvent = useOverviewStore((s) => s.pushRecentEvent);
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

  const handleBusEvent = useCallback((evt: PersonaEvent) => {
    pushRecentEvent(evt, 200);
  }, [pushRecentEvent]);
  useEventBusListener(handleBusEvent);

  // Derive available event types from the data
  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    for (const e of recentEvents) {
      if (e.event_type) types.add(e.event_type);
    }
    return Array.from(types).sort();
  }, [recentEvents]);

  // Filter + sort
  const filteredEvents = useMemo(() => {
    let events = recentEvents;
    if (statusFilter !== 'all') {
      events = events.filter((e: PersonaEvent) => e.status === statusFilter);
    }
    if (typeFilter !== 'all') {
      events = events.filter((e: PersonaEvent) => e.event_type === typeFilter);
    }
    if (selectedPersonaId) {
      events = events.filter((e: PersonaEvent) => e.target_persona_id === selectedPersonaId);
    }
    // Sort by created_at
    const sorted = [...events].sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sortDirection === 'desc' ? tb - ta : ta - tb;
    });
    return sorted;
  }, [recentEvents, statusFilter, typeFilter, selectedPersonaId, sortDirection]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [statusFilter, typeFilter, selectedPersonaId, sortDirection]);

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

  return {
    recentEvents, pendingEventCount, personas, availableTypes,
    statusFilter, setStatusFilter, typeFilter, setTypeFilter,
    sortDirection, toggleSortDirection,
    page, setPage, totalPages, pageSize: PAGE_SIZE,
    selectedEvent, setSelectedEvent,
    selectedPersonaId, setSelectedPersonaId: setPersonaId,
    isLoading, isRefreshing,
    filteredEvents, paginatedEvents,
    handleRefresh, getPersona,
  };
}
