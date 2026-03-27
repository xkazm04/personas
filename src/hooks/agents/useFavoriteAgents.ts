import { useSyncExternalStore, useCallback } from 'react';

const STORAGE_KEY = 'personas:favorite-agents';

// Module-level state shared across all hook consumers
let favorites: Set<string> = new Set();
const listeners = new Set<() => void>();

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function persist(ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

function notify() {
  for (const l of listeners) l();
}

// Initialize on module load
favorites = load();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot(): Set<string> {
  return favorites;
}

export function useFavoriteAgents() {
  const favs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const toggleFavorite = useCallback((id: string) => {
    const next = new Set(favorites);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    favorites = next;
    persist(next);
    notify();
  }, []);

  const isFavorite = useCallback((id: string) => favs.has(id), [favs]);

  return { favorites: favs, toggleFavorite, isFavorite };
}
