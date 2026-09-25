// The fused HUD's own state: what the instruments show, never where the
// reader is. Where the reader is lives in the engine (the camera, the path,
// the pinned technique) and in `councilStore.focus`, exactly as for the
// classic stage; this store holds only the HUD's choices, so no instrument
// grows its own idea of "where am I".
import { create } from 'zustand';

import type { GalaxyNode, TechniqueNode } from '../engine/types';
import { defaultMode, isWideStage, readStoredMode, storeMode, type HudMode } from './hudMode';

export type CareKind = 'waiting' | 'pending' | 'rejected';

/** The one tooltip every instrument shares: a node, and a stage point. */
export interface TipTarget {
  node: GalaxyNode;
  x: number;
  y: number;
  /** Sit above the point (the dock) rather than below it (the field). */
  above?: boolean;
}

/** What a command or a mode segment says it will do, and where it is. */
export interface SayTarget {
  kind: string;
  rect: { left: number; top: number; width: number; right: number };
}

interface FusedState {
  mode: HudMode;
  /** The reader picked the mode; resizing no longer changes it. */
  modeChosen: boolean;
  /** The dock shows every subject (spread) rather than what needs care. */
  spread: boolean;
  spreadChosen: boolean;
  filters: Record<CareKind, boolean>;
  /** The row of the nested list the reader rests on; it opens in place. */
  cursor: GalaxyNode | null;
  /** The pinned technique the document is showing. */
  technique: TechniqueNode | null;
  say: SayTarget | null;
  /** Bumped when `M` switches the mode, so the switch can light up. */
  flash: number;
  finderOpen: boolean;
  /** The field's magnifier. Off at open, as in the winner. */
  lensOn: boolean;
  tip: TipTarget | null;

  initStage: (width: number, height: number) => void;
  followStage: (width: number, height: number) => void;
  setMode: (mode: HudMode, byKey?: boolean) => void;
  setSpread: (spread: boolean) => void;
  toggleFilter: (kind: CareKind) => void;
  setCursor: (node: GalaxyNode | null) => void;
  setTechnique: (node: TechniqueNode | null) => void;
  setSay: (say: SayTarget | null) => void;
  setFinderOpen: (open: boolean) => void;
  setLensOn: (on: boolean) => void;
  setTip: (tip: TipTarget | null) => void;
}

export const useFusedStore = create<FusedState>((set, get) => ({
  mode: 'bar',
  modeChosen: false,
  spread: false,
  spreadChosen: false,
  filters: { waiting: true, pending: true, rejected: true },
  cursor: null,
  technique: null,
  say: null,
  flash: 0,
  finderOpen: false,
  lensOn: false,
  tip: null,

  initStage: (width, height) => {
    const stored = readStoredMode();
    set({
      mode: stored ?? defaultMode(width, height),
      modeChosen: stored !== null,
      spread: isWideStage(width, height),
      spreadChosen: false,
      cursor: null,
      technique: null,
      say: null,
    });
  },
  followStage: (width, height) => {
    const s = get();
    const next: Partial<FusedState> = {};
    if (!s.modeChosen) next.mode = defaultMode(width, height);
    if (!s.spreadChosen) next.spread = isWideStage(width, height);
    if ((next.mode ?? s.mode) !== s.mode || (next.spread ?? s.spread) !== s.spread) set(next);
  },
  setMode: (mode, byKey = false) => {
    if (mode === get().mode) return;
    storeMode(mode);
    set((s) => ({ mode, modeChosen: true, flash: byKey ? s.flash + 1 : s.flash }));
  },
  setSpread: (spread) => set({ spread, spreadChosen: true }),
  toggleFilter: (kind) => set((s) => ({ filters: { ...s.filters, [kind]: !s.filters[kind] } })),
  setCursor: (cursor) => set({ cursor }),
  setTechnique: (technique) => set({ technique }),
  setSay: (say) => set({ say }),
  setFinderOpen: (finderOpen) => set({ finderOpen }),
  setLensOn: (lensOn) => set({ lensOn }),
  setTip: (tip) => set({ tip }),
}));
