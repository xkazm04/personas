import { create } from 'zustand';

/**
 * Where the command palette should put its initial focus when it opens.
 *
 * - `'all'`     — the default global palette (Cmd/Ctrl+K): agents, navigation,
 *                 credentials, settings, … ranked by relevance.
 * - `'settings'` — opened from the title-bar ambient illustration. Settings are
 *                 surfaced first and an empty query shows recommended settings
 *                 (the quick-toggle row) instead of recent agents.
 *
 * Scope only biases ordering + the empty state — typing still searches every
 * source, so a single palette serves both entry points.
 */
export type PaletteScope = 'all' | 'settings';

interface CommandPaletteState {
  open: boolean;
  scope: PaletteScope;
  /** Open the palette, optionally focused on a scope (defaults to 'all'). */
  openPalette: (scope?: PaletteScope) => void;
  /** Toggle the palette. When opening, applies the given scope. */
  togglePalette: (scope?: PaletteScope) => void;
  closePalette: () => void;
}

/**
 * Shared open-state for the single global {@link CommandPalette}. Keeping it in
 * a tiny standalone store (rather than local component state) lets any surface
 * — the Cmd/Ctrl+K shortcut, the title-bar ambient illustration, future
 * "search this setup" affordances — open the same palette in the right scope
 * without prop-drilling or duplicate overlays.
 */
export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  open: false,
  scope: 'all',
  openPalette: (scope = 'all') => set({ open: true, scope }),
  togglePalette: (scope = 'all') =>
    set((s) => (s.open ? { open: false } : { open: true, scope })),
  closePalette: () => set({ open: false }),
}));
