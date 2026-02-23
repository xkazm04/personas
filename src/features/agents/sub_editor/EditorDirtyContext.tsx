import { createContext, useContext, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Lightweight dirty-state registry for PersonaEditor.
 *
 * Child components (PromptEditor, NotificationChannelSettings, etc.) call
 * `setTabDirty(tabName, true/false)` to register their dirty state.
 * PersonaEditor reads `isDirty` and `dirtyTabs` to gate persona switches
 * through one confirmation dialog.
 */

type Listener = () => void;

interface DirtyStore {
  /** Register or update dirty state for a tab. */
  setTabDirty: (tab: string, dirty: boolean) => void;
  /** Register a save callback for a tab (called on "Save & Switch"). */
  registerSave: (tab: string, save: () => Promise<void>) => void;
  /** Unregister a tab completely (on unmount). */
  unregister: (tab: string) => void;
  /** Save all dirty tabs that have registered save callbacks. */
  saveAll: () => Promise<void>;
  /** True if any tab is dirty. */
  getIsDirty: () => boolean;
  /** Names of all currently dirty tabs. */
  getDirtyTabs: () => string[];
  /** Clear all dirty state (used after discard). */
  clearAll: () => void;
  /** Subscribe to changes (for useSyncExternalStore). */
  subscribe: (listener: Listener) => () => void;
}

function createDirtyStore(): DirtyStore {
  const dirtyMap = new Map<string, boolean>();
  const saveMap = new Map<string, () => Promise<void>>();
  const listeners = new Set<Listener>();

  // Cache for getDirtyTabs — must be referentially stable between notifications
  let dirtyTabsCacheValid = false;
  let cachedDirtyTabs: string[] = [];

  function notify() {
    dirtyTabsCacheValid = false;
    for (const fn of listeners) fn();
  }

  return {
    setTabDirty(tab, dirty) {
      const prev = dirtyMap.get(tab) ?? false;
      if (prev !== dirty) {
        dirtyMap.set(tab, dirty);
        notify();
      }
    },
    registerSave(tab, save) {
      saveMap.set(tab, save);
    },
    unregister(tab) {
      dirtyMap.delete(tab);
      saveMap.delete(tab);
      notify();
    },
    async saveAll() {
      for (const [tab, dirty] of dirtyMap) {
        if (dirty) {
          const save = saveMap.get(tab);
          if (save) await save();
        }
      }
    },
    getIsDirty() {
      for (const dirty of dirtyMap.values()) {
        if (dirty) return true;
      }
      return false;
    },
    getDirtyTabs() {
      if (!dirtyTabsCacheValid) {
        const tabs: string[] = [];
        for (const [tab, dirty] of dirtyMap) {
          if (dirty) tabs.push(tab);
        }
        cachedDirtyTabs = tabs;
        dirtyTabsCacheValid = true;
      }
      return cachedDirtyTabs;
    },
    clearAll() {
      dirtyMap.clear();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const DirtyContext = createContext<DirtyStore | null>(null);

export function EditorDirtyProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<DirtyStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createDirtyStore();
  }
  return (
    <DirtyContext.Provider value={storeRef.current}>
      {children}
    </DirtyContext.Provider>
  );
}

function useDirtyStore(): DirtyStore | null {
  return useContext(DirtyContext);
}

/** Hook for child components to register their dirty state.
 *  Safe to call outside EditorDirtyProvider (no-op in that case). */
export function useEditorDirty(tab: string, isDirty: boolean, save?: () => Promise<void>) {
  const store = useDirtyStore();

  // Sync dirty state via effect — calling setTabDirty during render would
  // trigger notify() → useSyncExternalStore re-subscribe → infinite loop.
  useEffect(() => {
    if (store) store.setTabDirty(tab, isDirty);
  }, [store, tab, isDirty]);

  // registerSave does not call notify(), so updating it during render is safe.
  if (store && save) store.registerSave(tab, save);

  // Cleanup on unmount — wrapped in useCallback to stabilize
  const unregister = useCallback(() => {
    store?.unregister(tab);
  }, [store, tab]);

  return unregister;
}

/** Hook for PersonaEditor to read aggregate dirty state (must be within provider). */
export function useEditorDirtyState() {
  const store = useDirtyStore();
  if (!store) throw new Error('useEditorDirtyState must be used within EditorDirtyProvider');

  const isDirty = useSyncExternalStore(
    store.subscribe,
    store.getIsDirty,
  );

  const dirtyTabs = useSyncExternalStore(
    store.subscribe,
    store.getDirtyTabs,
  );

  return {
    isDirty,
    dirtyTabs,
    saveAll: store.saveAll,
    clearAll: store.clearAll,
  };
}
