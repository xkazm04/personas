import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { VIEW_MODE_CYCLE, DEFAULT_VIEW_MODE } from "@/lib/constants/uiModes";
import type { ViewMode } from "@/lib/constants/uiModes";

export type { ViewMode };

export interface ViewModeSlice {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
}

export const createViewModeSlice: StateCreator<SystemStore, [], [], ViewModeSlice> = (set) => ({
  viewMode: DEFAULT_VIEW_MODE,
  setViewMode: (mode) => set({ viewMode: mode }),
  toggleViewMode: () => set((s) => {
    const idx = VIEW_MODE_CYCLE.indexOf(s.viewMode);
    const next = VIEW_MODE_CYCLE[(idx + 1) % VIEW_MODE_CYCLE.length];
    return { viewMode: next };
  }),
});
