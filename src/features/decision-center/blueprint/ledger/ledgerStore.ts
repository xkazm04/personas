// The ledger's page state (bp useLedger.ts's module store): the tab, the scope, the filters, the focused row, the item
// open in the compare panel and how it shows screens. It outlives a close of the page (L, then L again lands where you
// were) and starts over for another product. The selection is NOT here: it is the sheet's shared `ui.selected` (Space),
// so the foot bar and the plan's multi-select are the same pick. A refcount-free one-way latch, so no HMR guard.
import { useSyncExternalStore } from 'react';
import type { ProposalStatus } from '@/lib/lensScan/wire';
import { NO_FILTER, type LedgerFilter, type LedgerScope, type LedgerTab } from '../model/ledger';

export type CompareTheme = 'light' | 'dark' | 'both';
export type CompareMode = 'side' | 'slider' | 'blink' | 'map';
export interface CompareView { theme: CompareTheme; mode: CompareMode }
export const COMPARE_THEMES: readonly CompareTheme[] = ['light', 'dark', 'both'];
export const COMPARE_MODES: readonly CompareMode[] = ['side', 'slider', 'blink', 'map'];

export interface LedgerUi extends LedgerFilter {
  tab: LedgerTab;
  scope: LedgerScope;
  focus: string | null;
  /** The pack item whose evidence the compare panel shows; null = closed. */
  open: string | null;
  cmp: CompareView;
  /** The compare panel takes the page's width (the table hides behind it). */
  wide: boolean;
  /** The compare panel opened itself once for this product (bp opens the first item on a wide window, once). */
  autoOpened: boolean;
}

export const EMPTY_LEDGER: LedgerUi = { ...NO_FILTER, tab: 'triage', scope: 'packs', focus: null, open: null, cmp: { theme: 'light', mode: 'side' }, wide: false, autoOpened: false };

export type SetLedger = (f: (u: LedgerUi) => LedgerUi) => void;

let STATE: { product: string; ui: LedgerUi } = { product: '', ui: EMPTY_LEDGER };
const subs = new Set<() => void>();
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const get = () => STATE.ui;

/** Change the page state (a no-op when `f` returns the same object). */
export const setLedger: SetLedger = (f) => { const n = f(STATE.ui); if (n === STATE.ui) return; STATE = { ...STATE, ui: n }; for (const s of [...subs]) s(); };

/** The page state for `product`: another product starts from an empty one. */
export function useLedgerUi(product: string): LedgerUi {
  if (STATE.product !== product) STATE = { product, ui: EMPTY_LEDGER }; // read during render, before any subscriber hears of it
  return useSyncExternalStore(sub, get, get);
}

/** Test hatch: forget every product's state. */
export function resetLedgerStore(): void { STATE = { product: '', ui: EMPTY_LEDGER }; }

const flip = <T,>(xs: ReadonlySet<T>, x: T): Set<T> => { const s = new Set(xs); if (!s.delete(x)) s.add(x); return s; };
export const toggleLens = (id: string) => setLedger((u) => ({ ...u, lens: flip(u.lens, id) }));
export const toggleStatus = (st: ProposalStatus) => setLedger((u) => ({ ...u, status: flip(u.status, st) }));
export const clearFilters = () => setLedger((u) => ({ ...u, ...NO_FILTER }));
/** The scopes' status chips differ, so a status filter does not cross a scope switch; focus and compare start over. */
export const setScope = (scope: LedgerScope) => setLedger((u) => (u.scope === scope ? u : { ...u, scope, status: new Set(), focus: null, open: null, wide: false }));
export const setTab = (tab: LedgerTab) => setLedger((u) => (u.tab === tab ? u : { ...u, tab }));
export const cycle = <T,>(xs: readonly T[], x: T): T => xs[(xs.indexOf(x) + 1) % xs.length] ?? x;
