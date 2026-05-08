import { useSyncExternalStore, useCallback } from 'react';
import { DEFAULT_DENSITY, DENSITY_TOKENS, isDensity, type Density, type DensityTokens } from '@/lib/density';

const STORAGE_PREFIX = 'density:';

const valueByView = new Map<string, Density>();
const listenersByView = new Map<string, Set<() => void>>();

function loadFromStorage(viewKey: string): Density {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + viewKey);
    if (isDensity(raw)) return raw;
  } catch {
    // localStorage may be unavailable (private mode, SSR-ish) — fall through
  }
  return DEFAULT_DENSITY;
}

function getDensity(viewKey: string): Density {
  const cached = valueByView.get(viewKey);
  if (cached !== undefined) return cached;
  const loaded = loadFromStorage(viewKey);
  valueByView.set(viewKey, loaded);
  return loaded;
}

function setDensityValue(viewKey: string, density: Density) {
  if (valueByView.get(viewKey) === density) return;
  valueByView.set(viewKey, density);
  try {
    localStorage.setItem(STORAGE_PREFIX + viewKey, density);
  } catch {
    // best-effort persistence
  }
  const listeners = listenersByView.get(viewKey);
  if (listeners) for (const l of listeners) l();
}

function subscribe(viewKey: string, cb: () => void): () => void {
  let set = listenersByView.get(viewKey);
  if (!set) {
    set = new Set();
    listenersByView.set(viewKey, set);
  }
  set.add(cb);
  return () => { set?.delete(cb); };
}

export interface UseDensityResult {
  density: Density;
  setDensity: (d: Density) => void;
  tokens: DensityTokens;
}

/**
 * Persisted, per-view density preference.
 *
 * Uses `localStorage[density:<viewKey>]` as the single source of truth across
 * components that share a `viewKey`. Multiple consumers with the same key stay
 * in sync via a useSyncExternalStore subscription.
 */
export function useDensity(viewKey: string): UseDensityResult {
  const subscribeForKey = useCallback((cb: () => void) => subscribe(viewKey, cb), [viewKey]);
  const getSnapshot = useCallback(() => getDensity(viewKey), [viewKey]);
  const density = useSyncExternalStore(subscribeForKey, getSnapshot, getSnapshot);
  const setDensity = useCallback((d: Density) => setDensityValue(viewKey, d), [viewKey]);
  return { density, setDensity, tokens: DENSITY_TOKENS[density] };
}
