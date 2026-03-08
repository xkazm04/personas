import { useState, useCallback, useMemo } from 'react';
import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';
import {
  type EventBusFilter,
  type SavedView,
  EMPTY_FILTER,
  applyFilter,
  loadSavedViews,
  persistSavedViews,
} from './eventBusFilterTypes';

export interface UseEventBusFilterReturn {
  filter: EventBusFilter;
  setFilter: (filter: EventBusFilter) => void;
  filteredEvents: RealtimeEvent[];
  filteredCount: number;
  totalCount: number;
  savedViews: SavedView[];
  activeViewId: string | null;
  applyView: (view: SavedView) => void;
  saveCurrentView: (name: string) => void;
  deleteView: (id: string) => void;
}

export function useEventBusFilter(events: RealtimeEvent[]): UseEventBusFilterReturn {
  const [filter, setFilter] = useState<EventBusFilter>(EMPTY_FILTER);
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => loadSavedViews());
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  const filteredEvents = useMemo(() => applyFilter(events, filter), [events, filter]);

  const handleSetFilter = useCallback((f: EventBusFilter) => {
    setFilter(f);
    setActiveViewId(null);
  }, []);

  const applyView = useCallback((view: SavedView) => {
    setFilter(view.filter);
    setActiveViewId(view.id);
  }, []);

  const saveCurrentView = useCallback((name: string) => {
    const newView: SavedView = {
      id: `view-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      filter: { ...filter },
      createdAt: Date.now(),
    };
    setSavedViews((prev) => {
      const next = [...prev, newView];
      persistSavedViews(next);
      return next;
    });
    setActiveViewId(newView.id);
  }, [filter]);

  const deleteView = useCallback((id: string) => {
    setSavedViews((prev) => {
      const next = prev.filter((v) => v.id !== id);
      persistSavedViews(next);
      return next;
    });
    setActiveViewId((prev) => (prev === id ? null : prev));
  }, []);

  return {
    filter,
    setFilter: handleSetFilter,
    filteredEvents,
    filteredCount: filteredEvents.length,
    totalCount: events.length,
    savedViews,
    activeViewId,
    applyView,
    saveCurrentView,
    deleteView,
  };
}
