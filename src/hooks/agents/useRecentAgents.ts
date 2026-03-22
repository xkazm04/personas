import { useSyncExternalStore, useCallback } from 'react';

const STORAGE_KEY = 'personas:recent-agents';
const MAX_RECENT = 5;

interface RecentEntry {
  id: string;
  ts: number;
}

// Module-level state shared across all hook consumers
let recents: RecentEntry[] = [];
const listeners = new Set<() => void>();

function load(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

function persist(entries: RecentEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function notify() {
  for (const l of listeners) l();
}

// Initialize on module load
recents = load();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot(): RecentEntry[] {
  return recents;
}

/** Record a persona as recently accessed. Call from selectPersona or similar. */
export function trackRecentAgent(id: string) {
  const next = [{ id, ts: Date.now() }, ...recents.filter((e) => e.id !== id)].slice(0, MAX_RECENT);
  recents = next;
  persist(next);
  notify();
}

/** Remove a persona from recents (e.g. when deleted). */
export function removeRecentAgent(id: string) {
  if (!recents.some((e) => e.id === id)) return;
  const next = recents.filter((e) => e.id !== id);
  recents = next;
  persist(next);
  notify();
}

export function useRecentAgents() {
  const entries = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const recentIds = useCallback(
    () => entries.map((e) => e.id),
    [entries],
  );

  return { recents: entries, recentIds: recentIds() };
}
