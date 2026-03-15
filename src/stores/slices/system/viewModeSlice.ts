import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { VIEW_MODE_CYCLE, DEFAULT_VIEW_MODE, TIERS, TIER_RANK } from "@/lib/constants/uiModes";
import type { ViewMode } from "@/lib/constants/uiModes";

export type { ViewMode };

/** Map legacy viewMode strings to the current tier system. */
const LEGACY_VIEW_MODE_MAP: Record<string, ViewMode> = {
  simple: TIERS.STARTER,
  full: TIERS.TEAM,
  dev: TIERS.BUILDER,
};

/** Ensure a persisted viewMode value is valid; migrate legacy values. */
function normalizeViewMode(raw: unknown): ViewMode {
  if (typeof raw === 'string') {
    // Already a valid tier
    if (raw in TIER_RANK) return raw as ViewMode;
    // Legacy value — migrate
    if (raw in LEGACY_VIEW_MODE_MAP) return LEGACY_VIEW_MODE_MAP[raw]!;
  }
  return DEFAULT_VIEW_MODE;
}

export interface ViewModeSlice {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
}

export const createViewModeSlice: StateCreator<SystemStore, [], [], ViewModeSlice> = (set) => ({
  viewMode: DEFAULT_VIEW_MODE,
  setViewMode: (mode) => set({ viewMode: normalizeViewMode(mode) }),
  toggleViewMode: () => set((s) => {
    const idx = VIEW_MODE_CYCLE.indexOf(s.viewMode);
    const next = VIEW_MODE_CYCLE[(idx + 1) % VIEW_MODE_CYCLE.length];
    return { viewMode: next };
  }),
});
