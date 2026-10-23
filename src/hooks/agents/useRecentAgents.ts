import { useSyncExternalStore, useCallback } from 'react';
import { silentCatch } from '@/lib/silentCatch';

const STORAGE_KEY = 'personas:recent-agents';
const MAX_RECENT = 5;

interface RecentEntry {
  id: string;
  ts: number;
}

// Module-level state shared across all hook consumers
let recents: RecentEntry[] = [];
const listeners = new Set<() => void>();

function isRecentEntry(v: unknown): v is RecentEntry {
  return (
    typeof v === 'object' && v !== null
    && typeof (v as { id?: unknown }).id === 'string'
    && typeof (v as { ts?: unknown }).ts === 'number'
  );
}

/**
 * Parse at the boundary. The stored value used to be asserted straight to
 * `RecentEntry[]`, so any non-array JSON (`{}`, `"x"`, `null` written by an
 * older build or a devtools edit) became `recents` and the next
 * `trackRecentAgent` threw on `.filter` - inside `selectPersona` and
 * `executePersona`, aborting the run start after its state was already set.
 */
function load(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentEntry).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/**
 * Best-effort: a full or blocked storage (quota, private mode) must not throw
 * out of `trackRecentAgent`, whose callers are selection and run start. The
 * in-memory list still updates; only persistence across reloads is lost.
 */
function persist(entries: RecentEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (err) {
    silentCatch('hooks/agents/useRecentAgents:persist')(err);
  }
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
