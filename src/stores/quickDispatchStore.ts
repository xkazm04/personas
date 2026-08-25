import { create } from 'zustand';

interface QuickDispatchState {
  open: boolean;
  openQuickDispatch: () => void;
  closeQuickDispatch: () => void;
  toggleQuickDispatch: () => void;
}

/**
 * Shared open-state for the single global {@link QuickDispatchOverlay}. Keeping
 * it in a tiny standalone store (rather than local component state) lets any
 * surface — the nav-mode `C` key in `TitleBarDock`, future "dispatch this"
 * affordances — open the same overlay without prop-drilling or duplicate
 * overlays. Modeled on `commandPaletteStore`.
 */
export const useQuickDispatchStore = create<QuickDispatchState>((set) => ({
  open: false,
  openQuickDispatch: () => set({ open: true }),
  closeQuickDispatch: () => set({ open: false }),
  toggleQuickDispatch: () => set((s) => ({ open: !s.open })),
}));
