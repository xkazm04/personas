import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';

/** Filter criteria for the event bus */
export interface EventBusFilter {
  /** Filter by event_type (empty = all) */
  eventTypes: string[];
  /** Filter by status (empty = all) */
  statuses: string[];
  /** Filter by source_type or source_id (empty = all) */
  sources: string[];
  /** Filter by target_persona_id (empty = all) */
  targetPersonaIds: string[];
  /** Free-text search across event fields */
  searchText: string;
}

/** A saved filter preset (view) */
export interface SavedView {
  id: string;
  name: string;
  filter: EventBusFilter;
  createdAt: number;
}

export const EMPTY_FILTER: EventBusFilter = {
  eventTypes: [],
  statuses: [],
  sources: [],
  targetPersonaIds: [],
  searchText: '',
};

export const KNOWN_EVENT_TYPES = [
  'webhook_received',
  'execution_completed',
  'persona_action',
  'credential_event',
  'task_created',
  'test_event',
  'custom',
  'deploy_started',
  'deploy_succeeded',
  'deploy_failed',
  'agent_undeployed',
  'credential_provisioned',
];

export const KNOWN_STATUSES = [
  'pending',
  'processing',
  'completed',
  'processed',
  'failed',
];

const STORAGE_KEY = 'personas:event-bus-saved-views';

/** Load saved views from localStorage */
export function loadSavedViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Persist saved views to localStorage */
export function persistSavedViews(views: SavedView[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
}

/** Check if a filter is active (any field non-empty) */
export function isFilterActive(filter: EventBusFilter): boolean {
  return (
    filter.eventTypes.length > 0 ||
    filter.statuses.length > 0 ||
    filter.sources.length > 0 ||
    filter.targetPersonaIds.length > 0 ||
    filter.searchText.trim().length > 0
  );
}

/** Count active filter dimensions */
export function activeFilterCount(filter: EventBusFilter): number {
  let count = 0;
  if (filter.eventTypes.length > 0) count++;
  if (filter.statuses.length > 0) count++;
  if (filter.sources.length > 0) count++;
  if (filter.targetPersonaIds.length > 0) count++;
  if (filter.searchText.trim()) count++;
  return count;
}

/** Apply a filter to a list of events */
export function applyFilter(events: RealtimeEvent[], filter: EventBusFilter): RealtimeEvent[] {
  if (!isFilterActive(filter)) return events;

  return events.filter((evt) => {
    if (filter.eventTypes.length > 0 && !filter.eventTypes.includes(evt.event_type)) {
      return false;
    }
    if (filter.statuses.length > 0 && !filter.statuses.includes(evt.status)) {
      return false;
    }
    if (filter.sources.length > 0) {
      const evtSource = evt.source_id || evt.source_type || '';
      if (!filter.sources.some((s) => evtSource.toLowerCase().includes(s.toLowerCase()))) {
        return false;
      }
    }
    if (filter.targetPersonaIds.length > 0) {
      if (!evt.target_persona_id || !filter.targetPersonaIds.includes(evt.target_persona_id)) {
        return false;
      }
    }
    if (filter.searchText.trim()) {
      const q = filter.searchText.toLowerCase();
      const haystack = [
        evt.event_type,
        evt.source_type,
        evt.source_id ?? '',
        evt.status,
        evt.target_persona_id ?? '',
        evt.payload ?? '',
        evt.error_message ?? '',
      ].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}
