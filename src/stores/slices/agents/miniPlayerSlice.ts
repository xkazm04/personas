import type { StateCreator } from "zustand";
import type { PersonaStore } from "../../storeTypes";

export interface MiniPlayerPosition {
  x: number;
  y: number;
}

export interface MiniPlayerSlice {
  // State
  miniPlayerPinned: boolean;
  miniPlayerExpanded: boolean;
  miniPlayerPosition: MiniPlayerPosition;

  // Actions
  pinMiniPlayer: () => void;
  unpinMiniPlayer: () => void;
  toggleMiniPlayerExpanded: () => void;
  setMiniPlayerPosition: (pos: MiniPlayerPosition) => void;
}

const DEFAULT_POSITION: MiniPlayerPosition = { x: -1, y: -1 };

export const createMiniPlayerSlice: StateCreator<
  PersonaStore,
  [],
  [],
  MiniPlayerSlice
> = (set) => ({
  miniPlayerPinned: false,
  miniPlayerExpanded: false,
  miniPlayerPosition: { ...DEFAULT_POSITION },

  pinMiniPlayer: () =>
    set({ miniPlayerPinned: true }),

  unpinMiniPlayer: () =>
    set({ miniPlayerPinned: false, miniPlayerExpanded: false }),

  toggleMiniPlayerExpanded: () =>
    set((state) => ({ miniPlayerExpanded: !state.miniPlayerExpanded })),

  setMiniPlayerPosition: (pos) =>
    set({ miniPlayerPosition: pos }),
});
