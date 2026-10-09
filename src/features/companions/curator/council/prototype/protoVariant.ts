// PROTOTYPE ROUND (spark council-readout, 2026-10-09). Which direction of the
// decisions panel and of the full-page council is on screen. `current` keeps
// the shipped DecisionsPanel / bench so every variant can be compared with
// the baseline; consolidation deletes this file with the losers.
//
// A store, not component state: the page header switches it and the stage
// reads it. `?panel=` / `?page=` in the URL (the shot harness) win over the
// persisted choice so a screenshot names what it shows.
import { create } from 'zustand';

import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

export type PanelVariant = 'current' | 'ledger' | 'cards' | 'table' | 'lanes';
export type PageVariant = 'current' | 'dossier' | 'scoreboard' | 'findings' | 'hybrid';

export const PANEL_VARIANTS: readonly PanelVariant[] = ['current', 'ledger', 'cards', 'table', 'lanes'];
export const PAGE_VARIANTS: readonly PageVariant[] = ['current', 'dossier', 'scoreboard', 'findings', 'hybrid'];

const PANEL_KEY = 'council-proto-panel';
const PAGE_KEY = 'council-proto-page';

function initial<T extends string>(param: string, key: string, allowed: readonly T[], fallback: T): T {
  let fromUrl: string | null;
  try {
    fromUrl = new URLSearchParams(window.location.search).get(param);
  } catch {
    fromUrl = null;
  }
  const raw = fromUrl ?? safeLocalGet(key, 'council:proto');
  return (allowed as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback;
}

interface VariantStore {
  panel: PanelVariant;
  page: PageVariant;
  setPanel: (next: PanelVariant) => void;
  setPage: (next: PageVariant) => void;
}

export const useProtoVariant = create<VariantStore>((set) => ({
  panel: initial('panel', PANEL_KEY, PANEL_VARIANTS, 'current'),
  page: initial('page', PAGE_KEY, PAGE_VARIANTS, 'current'),
  setPanel: (panel) => {
    safeLocalSet(PANEL_KEY, panel, 'council:proto');
    set({ panel });
  },
  setPage: (page) => {
    safeLocalSet(PAGE_KEY, page, 'council:proto');
    set({ page });
  },
}));
