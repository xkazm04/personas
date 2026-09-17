// Browser control module store — the ONE mutable copy of the whitelist rows
// and the open tab list for the whole app.
//
// Shape and doctrine are lifted from `notepad/notepadStore.ts`: a module
// singleton that mutates in memory synchronously, notifies subscribers, and
// hands views the SAME container until something writes, so an out-of-band
// change (Rust announcing a new tab, a scan finishing) paints without anyone
// polling a React tree. Rows here are FETCHED, never persisted — there is no
// localStorage tier and no optimistic durable write, because the server owns
// every decision this feature makes.
//
// WHY A MODULE STORE AND NOT A ZUSTAND SLICE. Both routes unmount on nav-away
// (they are lazy), and the tab list must survive that: leaving the Webview is
// not closing anybody's page. A module singleton keeps the last event payload
// so a remount paints warm instead of re-ghosting (loading pattern v2, law 4).
//
// THE SCAN LANE POLLS, AND SAYS SO. WP3 had not landed `EventName.BROWSER_SCAN`
// when this was written, so there is no event to subscribe to. While ANY row
// reads `scan_status === 'running'` the store re-reads `browser_sites_list` on
// a 2.5s tick and stops the moment none does. `browser_sites_list` is
// authoritative for status, report and tier, so this is correct — just chattier
// than the event will be. When the event lands, delete `startScanPoll` and
// subscribe instead.
import type { UnlistenFn } from '@tauri-apps/api/event';

import * as browserApi from '@/api/browser';
import { silentCatch } from '@/lib/silentCatch';

import type { BrowserSite, BrowserTab } from './types';

/** How often the scan lane re-reads rows while a scan is running. */
export const SCAN_POLL_MS = 2500;

/** The whole readable state. Snapshots hand back frozen-by-convention copies. */
export interface BrowserSnapshot {
  sites: readonly BrowserSite[];
  sitesLoading: boolean;
  sitesLoaded: boolean;
  tabs: readonly BrowserTab[];
  tabsLoading: boolean;
  /** The tab the address bar and page controls act on. */
  activeTabId: number | null;
}

// --- pure transitions ---------------------------------------------------------
//
// Exported so the reducer can be tested without a Tauri bridge. Every one takes
// a snapshot and returns a snapshot; none of them touches module state.

/**
 * Adopt the full tab list Rust just announced.
 *
 * The active tab follows, in order: the tab Rust says is focused, then the
 * previously active tab if it still exists, then the first tab, then none.
 * Rust's `focused` wins because the page host is a real OS window — whatever
 * it is showing IS the active tab, and a React-side opinion that disagrees
 * would put the address bar on a page the user cannot see.
 */
export function adoptTabs(prev: BrowserSnapshot, tabs: readonly BrowserTab[]): BrowserSnapshot {
  const focused = tabs.find((tab) => tab.focused);
  const kept = tabs.some((tab) => tab.id === prev.activeTabId) ? prev.activeTabId : null;
  const activeTabId = focused?.id ?? kept ?? tabs[0]?.id ?? null;
  return { ...prev, tabs, tabsLoading: false, activeTabId };
}

/** Replace one row in place (a command answered with the updated row). */
export function adoptSite(prev: BrowserSnapshot, row: BrowserSite): BrowserSnapshot {
  const known = prev.sites.some((site) => site.origin === row.origin);
  const sites = known
    ? prev.sites.map((site) => (site.origin === row.origin ? row : site))
    : [...prev.sites, row].sort((a, b) => a.origin.localeCompare(b.origin));
  return { ...prev, sites };
}

/** Drop one row (a delete answered true). */
export function dropSite(prev: BrowserSnapshot, origin: string): BrowserSnapshot {
  return { ...prev, sites: prev.sites.filter((site) => site.origin !== origin) };
}

/** Adopt a freshly fetched list, newest server truth wins wholesale. */
export function adoptSites(prev: BrowserSnapshot, sites: readonly BrowserSite[]): BrowserSnapshot {
  return { ...prev, sites, sitesLoading: false, sitesLoaded: true };
}

/** True while any row has a scan in flight — what drives the poll. */
export function hasRunningScan(sites: readonly BrowserSite[]): boolean {
  return sites.some((site) => site.scan_status === 'running');
}

/** The active tab object, or null. */
export function activeTabOf(snapshot: BrowserSnapshot): BrowserTab | null {
  return snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ?? null;
}

// --- module singleton ---------------------------------------------------------

const EMPTY: BrowserSnapshot = {
  sites: [],
  sitesLoading: false,
  sitesLoaded: false,
  tabs: [],
  tabsLoading: false,
  activeTabId: null,
};

let state: BrowserSnapshot = EMPTY;

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeBrowser(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The snapshot getter `useSyncExternalStore` compares by identity. */
export function browserSnapshot(): BrowserSnapshot {
  return state;
}

function commit(next: BrowserSnapshot): void {
  if (next === state) return;
  state = next;
  for (const listener of [...listeners]) listener();
}

/** Test-only reset hatch — a module singleton with no way back is untestable. */
export function resetBrowserStore(): void {
  stopScanPoll();
  void teardownTabs();
  state = EMPTY;
  for (const listener of [...listeners]) listener();
}

// --- sites --------------------------------------------------------------------

export async function refreshSites(): Promise<void> {
  if (!state.sitesLoaded) commit({ ...state, sitesLoading: true });
  try {
    const rows = await browserApi.listSites();
    commit(adoptSites(state, rows));
    syncScanPoll();
  } catch (err) {
    commit({ ...state, sitesLoading: false, sitesLoaded: true });
    silentCatch('browser sites refresh')(err);
  }
}

/** Adopt a row a mutating command answered with — no refetch round-trip. */
export function putSite(row: BrowserSite): void {
  commit(adoptSite(state, row));
  syncScanPoll();
}

export function forgetSite(origin: string): void {
  commit(dropSite(state, origin));
  syncScanPoll();
}

// --- scan poll ----------------------------------------------------------------

let scanTimer: ReturnType<typeof setInterval> | null = null;

function syncScanPoll(): void {
  if (hasRunningScan(state.sites)) startScanPoll();
  else stopScanPoll();
}

function startScanPoll(): void {
  if (scanTimer) return;
  scanTimer = setInterval(() => {
    void refreshSites();
  }, SCAN_POLL_MS);
}

function stopScanPoll(): void {
  if (!scanTimer) return;
  clearInterval(scanTimer);
  scanTimer = null;
}

// --- tabs ---------------------------------------------------------------------

let tabsUnlisten: Promise<UnlistenFn> | null = null;

export async function refreshTabs(): Promise<void> {
  commit({ ...state, tabsLoading: state.tabs.length === 0 });
  try {
    const tabs = await browserApi.listTabs();
    commit(adoptTabs(state, tabs));
  } catch (err) {
    commit({ ...state, tabsLoading: false });
    silentCatch('browser tabs refresh')(err);
  }
}

/**
 * Seed from `browser_webview_list`, then follow `browser-tabs`.
 *
 * Idempotent: the Webview route mounts and unmounts freely, and a second
 * subscribe would double every announcement.
 */
export async function initTabs(): Promise<void> {
  if (!tabsUnlisten) {
    tabsUnlisten = browserApi.listenTabs((tabs) => {
      commit(adoptTabs(state, tabs));
    });
    tabsUnlisten.catch(silentCatch('browser tabs listen'));
  }
  await refreshTabs();
}

async function teardownTabs(): Promise<void> {
  const pending = tabsUnlisten;
  tabsUnlisten = null;
  if (!pending) return;
  try {
    (await pending)();
  } catch (err) {
    silentCatch('browser tabs unlisten')(err);
  }
}

/** Point the address bar at a tab without asking Rust to move focus. */
export function selectTab(id: number | null): void {
  commit({ ...state, activeTabId: id });
}
