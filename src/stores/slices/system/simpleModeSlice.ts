import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";

/** Which tab is currently active inside the Simple-mode Home Base. */
export type SimpleTab = 'mosaic' | 'console' | 'inbox';

export interface SimpleModeSlice {
  /** Persisted active tab in Simple mode. Survives Simple↔Power toggles and app reloads. */
  activeSimpleTab: SimpleTab;
  setActiveSimpleTab: (tab: SimpleTab) => void;
}

/**
 * Owns the tab-selection state for the Simple-mode Home Base page. Lives in
 * the system store so it survives mode toggles and is persisted alongside the
 * rest of the UI chrome state (see `partialize` in systemStore.ts).
 */
export const createSimpleModeSlice: StateCreator<
  SystemStore,
  [],
  [],
  SimpleModeSlice
> = (set) => ({
  activeSimpleTab: 'mosaic',
  setActiveSimpleTab: (tab) => set({ activeSimpleTab: tab }),
});
