import { useMemo, useEffect, useState, useCallback } from 'react';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import type { PersonaEvent, PersonaMessage } from '@/lib/types/types';
import { usePersonaMap, useEnrichedRecords } from '@/hooks/utility/data/usePersonaMap';

// -- Timeline item types --------------------------------------------------

export interface TimelineEventItem {
  kind: 'event';
  id: string;
  timestamp: string;
  data: PersonaEvent;
  personaName?: string;
  personaIcon?: string;
  personaColor?: string;
}

export interface TimelineMessageItem {
  kind: 'message';
  id: string;
  timestamp: string;
  data: PersonaMessage;
}

export type TimelineItem = TimelineEventItem | TimelineMessageItem;

// -- Hook -----------------------------------------------------------------

export function useActivityTimeline() {
  const {
    recentEvents, fetchRecentEvents,
    messages, fetchMessages,
  } = useOverviewStore(useShallow((s) => ({
    recentEvents: s.recentEvents,
    fetchRecentEvents: s.fetchRecentEvents,
    messages: s.messages,
    fetchMessages: s.fetchMessages,
  })));

  const personaMap = usePersonaMap();
  const enrichedMessages = useEnrichedRecords(messages, personaMap);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      await Promise.all([fetchRecentEvents(100), fetchMessages(true)]);
      if (active) setIsLoading(false);
    };
    load();
    return () => { active = false; };
  }, [fetchRecentEvents, fetchMessages]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([fetchRecentEvents(100), fetchMessages(true)]);
    setIsLoading(false);
  }, [fetchRecentEvents, fetchMessages]);

  const items = useMemo<TimelineItem[]>(() => {
    const eventItems: TimelineItem[] = recentEvents.map((e) => {
      const p = e.target_persona_id ? personaMap.get(e.target_persona_id) : undefined;
      return {
        kind: 'event',
        id: `evt-${e.id}`,
        timestamp: e.created_at,
        data: e,
        personaName: p?.name,
        personaIcon: p?.icon ?? undefined,
        personaColor: p?.color ?? undefined,
      };
    });

    const msgItems: TimelineItem[] = enrichedMessages.map((m) => ({
      kind: 'message',
      id: `msg-${m.id}`,
      timestamp: m.created_at,
      data: m,
    }));

    // Merge and sort descending (newest first)
    return [...eventItems, ...msgItems].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [recentEvents, enrichedMessages, personaMap]);

  return { items, isLoading, refresh };
}
