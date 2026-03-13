import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";

export type ViewMode = 'simple' | 'full' | 'dev';

export interface ViewModeSlice {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
}

export const createViewModeSlice: StateCreator<SystemStore, [], [], ViewModeSlice> = (set) => ({
  viewMode: 'full' as ViewMode,
  setViewMode: (mode) => set({ viewMode: mode }),
  toggleViewMode: () => set((s) => ({
    viewMode: s.viewMode === 'simple' ? 'full' : s.viewMode === 'full' ? 'dev' : 'simple',
  })),
});
