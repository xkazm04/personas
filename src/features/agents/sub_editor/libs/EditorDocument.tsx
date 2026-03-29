import { createContext, useContext, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { PersonaOperation } from '@/api/agents/personas';
import { createLogger } from "@/lib/log";

const logger = createLogger("editor-document");

/**
 * EditorDocument -- unified dirty-state, save registry, optimistic transaction
 * coordinator, and undo/redo stack for the persona edit session.
 *
 * Every editor tab registers its dirty flag and save callback via `useEditorDirty`.
 * PersonaEditor reads `isDirty` and `dirtyTabs` to gate persona switches
 * and `saveAll` to persist all pending changes atomically.
 *
 * The undo stack records PersonaOperation history so that Ctrl+Z can reverse
 * edits across tabs. Each entry captures the forward operation and a restore
 * callback that re-applies the prior state.
 */

/** Error thrown by saveAll when one or more tabs fail to save. */
export class TabSaveError extends Error {
  readonly failedTabs: string[];
  readonly savedTabs: string[];
  constructor(failedTabs: string[], savedTabs: string[] = []) {
    super(`Failed to save: ${failedTabs.join(', ')}`);
    this.name = 'TabSaveError';
    this.failedTabs = failedTabs;
    this.savedTabs = savedTabs;
  }
}

type Listener = () => void;

// -- Undo / Redo types --

/** An entry in the undo stack. */
export interface UndoEntry {
  /** The operation that was applied (for display / analytics). */
  operation: PersonaOperation;
  /** Restore the state that existed before this operation was applied. */
  restore: () => Promise<void>;
  /** Re-apply the forward operation (used by redo). */
  reapply: () => Promise<void>;
}

const MAX_UNDO_DEPTH = 50;

// -- DirtyStore --

interface DirtyStore {
  /** Register or update dirty state for a tab. */
  setTabDirty: (tab: string, dirty: boolean) => void;
  /** Register a save callback for a tab (called on "Save & Switch"). */
  registerSave: (tab: string, save: () => Promise<void>) => void;
  /** Register a cancel callback for a tab's debounced save. */
  registerCancel: (tab: string, cancel: () => void) => void;
  /** Unregister a tab completely (on unmount). */
  unregister: (tab: string) => void;
  /**
   * Save all dirty tabs sequentially.
   * Stops on first failure to minimise cross-tab inconsistency.
   * Tabs that succeeded before the failure are marked clean (they are
   * already persisted). The thrown TabSaveError lists both failed and
   * saved tabs so the UI can report the exact state to the user.
   */
  saveAll: () => Promise<void>;
  /** Cancel all pending debounced saves across all tabs. */
  cancelAll: () => void;
  /** True if any tab is dirty. */
  getIsDirty: () => boolean;
  /** Names of all currently dirty tabs. */
  getDirtyTabs: () => string[];
  /** Clear all dirty state (used after discard). */
  clearAll: () => void;
  /** Subscribe to changes (for useSyncExternalStore). */
  subscribe: (listener: Listener) => () => void;

  // -- Undo / Redo --

  /** Push an undoable operation onto the stack. Clears the redo stack. */
  pushUndo: (entry: UndoEntry) => void;
  /** Undo the most recent operation. Returns false if nothing to undo. */
  undo: () => Promise<boolean>;
  /** Redo the most recently undone operation. Returns false if nothing to redo. */
  redo: () => Promise<boolean>;
  /** True if at least one undo entry exists. */
  getCanUndo: () => boolean;
  /** True if at least one redo entry exists. */
  getCanRedo: () => boolean;
  /** Clear both undo and redo stacks (e.g. on persona switch). */
  clearHistory: () => void;
}

function createDirtyStore(): DirtyStore {
  const dirtyMap = new Map<string, boolean>();
  const saveMap = new Map<string, () => Promise<void>>();
  const cancelMap = new Map<string, () => void>();
  const listeners = new Set<Listener>();

  // Undo / redo stacks
  const undoStack: UndoEntry[] = [];
  const redoStack: UndoEntry[] = [];

  // Cache for getDirtyTabs -- must be referentially stable between notifications
  let dirtyTabsCacheValid = false;
  let cachedDirtyTabs: string[] = [];

  // Cache for undo/redo boolean getters
  let cachedCanUndo = false;
  let cachedCanRedo = false;

  function notify() {
    dirtyTabsCacheValid = false;
    cachedCanUndo = undoStack.length > 0;
    cachedCanRedo = redoStack.length > 0;
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
    registerCancel(tab, cancel) {
      cancelMap.set(tab, cancel);
    },
    unregister(tab) {
      dirtyMap.delete(tab);
      saveMap.delete(tab);
      cancelMap.delete(tab);
      notify();
    },

    async saveAll() {
      // 1. Collect dirty tabs
      const tabsToSave = [...dirtyMap.entries()].filter(([, dirty]) => dirty);
      if (tabsToSave.length === 0) {
        notify();
        return;
      }

      // 2. Save sequentially -- stop on first failure to prevent cross-tab inconsistency
      const savedTabs: string[] = [];
      for (const [tab] of tabsToSave) {
        const save = saveMap.get(tab);
        if (!save) {
          savedTabs.push(tab);
          dirtyMap.set(tab, false);
          continue;
        }
        try {
          await save();
          savedTabs.push(tab);
          dirtyMap.set(tab, false);
        } catch (err) {
          logger.error(`Failed to save tab`, { tab, reason: err });
          // Tabs that succeeded are already persisted -- mark them clean.
          // Only remaining (unsaved) tabs stay dirty.
          notify();
          const failedTabs = tabsToSave
            .filter(([t]) => !savedTabs.includes(t))
            .map(([t]) => t);
          throw new TabSaveError(failedTabs, savedTabs);
        }
      }

      // 3. Full success -- all tabs clean
      notify();
    },

    cancelAll() {
      for (const cancel of cancelMap.values()) {
        cancel();
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

    // -- Undo / Redo --

    pushUndo(entry) {
      undoStack.push(entry);
      if (undoStack.length > MAX_UNDO_DEPTH) undoStack.shift();
      // Any new edit invalidates the redo branch
      redoStack.length = 0;
      notify();
    },

    async undo() {
      const entry = undoStack.pop();
      if (!entry) return false;
      try {
        await entry.restore();
        // Push to redo so the user can re-apply
        redoStack.push(entry);
      } catch (err) {
        logger.error('Undo failed', { error: err });
        // Put it back -- the undo didn't succeed
        undoStack.push(entry);
      }
      notify();
      return true;
    },

    async redo() {
      const entry = redoStack.pop();
      if (!entry) return false;
      try {
        await entry.reapply();
        undoStack.push(entry);
      } catch (err) {
        logger.error('Redo failed', { error: err });
        redoStack.push(entry);
      }
      notify();
      return true;
    },

    getCanUndo() {
      return cachedCanUndo;
    },

    getCanRedo() {
      return cachedCanRedo;
    },

    clearHistory() {
      undoStack.length = 0;
      redoStack.length = 0;
      notify();
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
export function useEditorDirty(tab: string, isDirty: boolean, save?: () => Promise<void>, cancel?: () => void) {
  const store = useDirtyStore();

  // Sync dirty state via effect -- calling setTabDirty during render would
  // trigger notify() -> useSyncExternalStore re-subscribe -> infinite loop.
  useEffect(() => {
    if (store) store.setTabDirty(tab, isDirty);
  }, [store, tab, isDirty]);

  // registerSave / registerCancel do not call notify(), so updating during render is safe.
  if (store && save) store.registerSave(tab, save);
  if (store && cancel) store.registerCancel(tab, cancel);

  // Cleanup on unmount -- wrapped in useCallback to stabilize
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
    cancelAll: store.cancelAll,
    clearAll: store.clearAll,
  };
}

/** Hook to access the undo/redo stack (must be within provider). */
export function useEditorHistory() {
  const store = useDirtyStore();
  if (!store) throw new Error('useEditorHistory must be used within EditorDirtyProvider');

  const canUndo = useSyncExternalStore(store.subscribe, store.getCanUndo);
  const canRedo = useSyncExternalStore(store.subscribe, store.getCanRedo);

  return {
    canUndo,
    canRedo,
    pushUndo: store.pushUndo,
    undo: store.undo,
    redo: store.redo,
    clearHistory: store.clearHistory,
  };
}
