import type { StateCreator } from "zustand";
import type { VaultStore } from "../../storeTypes";
import { silentCatch } from '@/lib/silentCatch';


export type CatalogSortMode =
  | "alphabetical"
  | "popular"
  | "recently_added"
  | "most_used_with_recipes";

const STORAGE_KEY = "persona-catalog-prefs";
const DEFAULT_SORT_MODE: CatalogSortMode = "alphabetical";

const VALID_SORT_MODES: ReadonlySet<CatalogSortMode> = new Set([
  "alphabetical",
  "popular",
  "recently_added",
  "most_used_with_recipes",
]);

interface PersistedPrefs {
  sortMode: CatalogSortMode;
  viewCounts: Record<string, number>;
}

function loadPersisted(): PersistedPrefs {
  if (typeof localStorage === "undefined") {
    return { sortMode: DEFAULT_SORT_MODE, viewCounts: {} };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sortMode: DEFAULT_SORT_MODE, viewCounts: {} };
    const parsed = JSON.parse(raw) as Partial<PersistedPrefs>;
    const sortMode = parsed.sortMode && VALID_SORT_MODES.has(parsed.sortMode)
      ? parsed.sortMode
      : DEFAULT_SORT_MODE;
    const viewCounts =
      parsed.viewCounts && typeof parsed.viewCounts === "object" && !Array.isArray(parsed.viewCounts)
        ? Object.fromEntries(
            Object.entries(parsed.viewCounts).filter(
              ([, v]) => typeof v === "number" && Number.isFinite(v) && v >= 0,
            ) as [string, number][],
          )
        : {};
    return { sortMode, viewCounts };
  } catch {
    return { sortMode: DEFAULT_SORT_MODE, viewCounts: {} };
  }
}

function savePersisted(prefs: PersistedPrefs): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (err) { silentCatch("stores/slices/vault/catalogPrefsSlice:catch1")(err); }
}

export interface CatalogPrefsSlice {
  catalogSortMode: CatalogSortMode;
  catalogConnectorViewCounts: Record<string, number>;
  setCatalogSortMode: (mode: CatalogSortMode) => void;
  recordCatalogConnectorView: (connectorName: string) => void;
}

export const createCatalogPrefsSlice: StateCreator<VaultStore, [], [], CatalogPrefsSlice> = (set, get) => {
  const initial = loadPersisted();
  return {
    catalogSortMode: initial.sortMode,
    catalogConnectorViewCounts: initial.viewCounts,

    setCatalogSortMode: (mode: CatalogSortMode) => {
      set({ catalogSortMode: mode });
      savePersisted({ sortMode: mode, viewCounts: get().catalogConnectorViewCounts });
    },

    recordCatalogConnectorView: (connectorName: string) => {
      if (!connectorName) return;
      const current = get().catalogConnectorViewCounts;
      const next = { ...current, [connectorName]: (current[connectorName] ?? 0) + 1 };
      set({ catalogConnectorViewCounts: next });
      savePersisted({ sortMode: get().catalogSortMode, viewCounts: next });
    },
  };
};
