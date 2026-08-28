import { useSyncExternalStore, useCallback } from 'react';
import { DEFAULT_DENSITY, DENSITY_TOKENS, isDensity, type Density, type DensityTokens } from '@/lib/density';
import { silentCatch } from '@/lib/silentCatch';


const STORAGE_PREFIX = 'density:';

/**
 * The registry of every view allowed to own a persisted density preference,
 * mapped to the density it starts at.
 *
 * This exists so the key space is *closed*. Before it, `useDensity` accepted any
 * string, wrote `density:<that string>` forever, and grew two module maps that
 * nothing pruned — so "which of these rows is dead?" had no computable answer.
 * Retiring a view is now a deletion here, and the next sweep reaps its row.
 */
export const DENSITY_VIEWS = {
  'execution-list': DEFAULT_DENSITY,
} as const satisfies Record<string, Density>;

export type DensityViewKey = keyof typeof DENSITY_VIEWS;

function isKnownViewKey(key: string): key is DensityViewKey {
  return Object.prototype.hasOwnProperty.call(DENSITY_VIEWS, key);
}

const valueByView = new Map<DensityViewKey, Density>();
const listenersByView = new Map<DensityViewKey, Set<() => void>>();

/**
 * Drop every `density:` row whose view is no longer in {@link DENSITY_VIEWS}.
 * Returns the storage keys it removed so callers and tests can assert on the
 * sweep itself rather than on its side effects.
 */
export function reapUnknownDensityKeys(): string[] {
  const doomed: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      if (!isKnownViewKey(key.slice(STORAGE_PREFIX.length))) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch (err) { silentCatch("hooks/utility/data/useDensity:reap")(err); }
  return doomed;
}

let swept = false;
function sweepOnce() {
  if (swept) return;
  swept = true;
  reapUnknownDensityKeys();
}

/** Test seam: forget the cached values and re-arm the one-shot sweep. */
export function resetDensityStateForTests() {
  valueByView.clear();
  listenersByView.clear();
  swept = false;
}

function loadFromStorage(viewKey: DensityViewKey): Density {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + viewKey);
    if (isDensity(raw)) return raw;
  } catch (err) { silentCatch("hooks/utility/data/useDensity:catch1")(err); }
  return DENSITY_VIEWS[viewKey];
}

function getDensity(viewKey: DensityViewKey): Density {
  const cached = valueByView.get(viewKey);
  if (cached !== undefined) return cached;
  sweepOnce();
  const loaded = loadFromStorage(viewKey);
  valueByView.set(viewKey, loaded);
  return loaded;
}

function setDensityValue(viewKey: DensityViewKey, density: Density) {
  if (valueByView.get(viewKey) === density) return;
  valueByView.set(viewKey, density);
  try {
    localStorage.setItem(STORAGE_PREFIX + viewKey, density);
  } catch (err) { silentCatch("hooks/utility/data/useDensity:catch2")(err); }
  const listeners = listenersByView.get(viewKey);
  if (listeners) for (const l of listeners) l();
}

function subscribe(viewKey: DensityViewKey, cb: () => void): () => void {
  let set = listenersByView.get(viewKey);
  if (!set) {
    set = new Set();
    listenersByView.set(viewKey, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
    if (set?.size === 0) listenersByView.delete(viewKey);
  };
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
 *
 * `viewKey` is constrained to {@link DENSITY_VIEWS}; adding a view means adding
 * it there, which is also what makes a retired view's row reapable.
 */
export function useDensity(viewKey: DensityViewKey): UseDensityResult {
  const subscribeForKey = useCallback((cb: () => void) => subscribe(viewKey, cb), [viewKey]);
  const getSnapshot = useCallback(() => getDensity(viewKey), [viewKey]);
  const density = useSyncExternalStore(subscribeForKey, getSnapshot, getSnapshot);
  const setDensity = useCallback((d: Density) => setDensityValue(viewKey, d), [viewKey]);
  return { density, setDensity, tokens: DENSITY_TOKENS[density] };
}
