import { useEffect, useState, useCallback, useMemo } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { useEventBusListener } from '@/hooks/realtime/useEventBusListener';
import { useOverviewFilters } from '@/features/overview/components/dashboard/OverviewFilterContext';
import type { PersonaEvent } from '@/lib/types/types';

export type EventFilter = 'all' | 'pending' | 'completed' | 'failed';

export function useEventLog() {
  const recentEvents = usePersonaStore((s) => s.recentEvents);
  const pendingEventCount = usePersonaStore((s) => s.pendingEventCount);
  const fetchRecentEvents = usePersonaStore((s) => s.fetchRecentEvents);
  const pushRecentEvent = usePersonaStore((s) => s.pushRecentEvent);
  const personas = usePersonaStore((s) => s.personas);

  const [filter, setFilter] = useState<EventFilter>('all');
  const [selectedEvent, setSelectedEvent] = useState<PersonaEvent | null>(null);
  const { selectedPersonaId, setSelectedPersonaId } = useOverviewFilters();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);

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

  const filteredEvents = useMemo(() => {
    let events = recentEvents;
    if (filter !== 'all') {
      events = events.filter((e: PersonaEvent) => e.status === filter);
    }
    if (selectedPersonaId) {
      events = events.filter((e: PersonaEvent) => e.target_persona_id === selectedPersonaId);
    }
    return events;
  }, [recentEvents, filter, selectedPersonaId]);

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

  return {
    recentEvents, pendingEventCount, personas,
    filter, setFilter,
    selectedEvent, setSelectedEvent,
    selectedPersonaId, setSelectedPersonaId,
    isLoading, isRefreshing,
    copiedPayload, setCopiedPayload,
    filteredEvents,
    handleRefresh, getPersona,
  };
}
