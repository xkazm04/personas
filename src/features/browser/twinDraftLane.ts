// Twin draft lane — the ONE copy of "where the Twin toolbar stands" for the
// Browser webview route.
//
// Shape and doctrine follow `browserStore.ts`: a module singleton that mutates
// synchronously, notifies subscribers, and exports its transitions as pure
// functions so the reducer is testable without a Tauri bridge. A module store
// rather than React state because the route unmounts on nav-away and the
// remembered target (the box the user picked) must NOT — the page is still
// there, so a remount should be able to regenerate into the same box.
//
// THE FLOW. `arm` puts the page in pick mode and BLOCKS on the user's next
// click in a writable box (`browser_webview_pick_target`, up to ~3 min). The
// picked target, minus its ref, is the page context the twin drafts against;
// the draft is typed STRAIGHT INTO the box (`browser_webview_fill`) — there is
// no app-side draft panel, the user edits in the page and sends with the
// site's own button or the toolbar's Submit. Every insert is a twin
// communication on channel `browser`.
//
// REFS DIE ON NAVIGATION. The ref the page minted is bound to its ref
// generation, so the lane follows the tab list and drops back to idle the
// moment the remembered tab's url changes or the tab disappears. A regenerate
// against a dead ref would only produce a `stale_page` refusal.
//
// STALENESS GUARD. Every async run carries a `createLatestWins()` token minted
// when it started and re-checks `isCurrent` after each await (golden path
// stale-response-guard). A reset, a cancel or a second arm mints a newer token,
// so a late answer from an abandoned run cannot overwrite a newer state.
import * as browserApi from '@/api/browser';
import * as twinApi from '@/api/twin/twin';
import type { TwinChannelKind } from '@/api/enums';
import type { PickedTarget } from '@/lib/bindings/PickedTarget';
import type { TwinPageContext } from '@/lib/bindings/TwinPageContext';
import type { TwinSteer } from '@/lib/bindings/TwinSteer';
import { resolveError } from '@/lib/errors/errorRegistry';
import { silentCatch } from '@/lib/silentCatch';
import { createLatestWins } from '@/stores/util/latestWins';
import { isTauriError } from '@/lib/types/tauriError';

import { browserSnapshot, subscribeBrowser } from './browserStore';
import type { BrowserTab } from './types';

export type TwinDraftPhase = 'idle' | 'armed' | 'drafting' | 'inserted' | 'failed';

/** The whole readable state. Snapshots are frozen-by-convention copies. */
export interface TwinDraftSnapshot {
  phase: TwinDraftPhase;
  /** The tab the lane is bound to while not idle. */
  tabId: number | null;
  /**
   * The tab's url when the lane bound to it. NOT the target's url: the lane
   * arms before any target exists, and a navigation while armed must reset it
   * just as one after the insert does.
   */
  tabUrl: string | null;
  /** The box the user picked; remembered until navigation so Regenerate can re-draft in place. */
  target: PickedTarget | null;
  lastDraft: string | null;
  /** The registry-resolved message when `phase === 'failed'`. */
  error: string | null;
  steer: TwinSteer | null;
  directions: string;
  /** The inline "Submit the form?" one-liner is showing. */
  confirmingSubmit: boolean;
}

/** The channel every page insert is recorded under. */
const BROWSER_CHANNEL: TwinChannelKind = 'browser';

const EMPTY: TwinDraftSnapshot = {
  phase: 'idle',
  tabId: null,
  tabUrl: null,
  target: null,
  lastDraft: null,
  error: null,
  steer: null,
  directions: '',
  confirmingSubmit: false,
};

// --- pure transitions ---------------------------------------------------------

/** Bind to a tab and wait for the pick. Steering survives; everything page-bound is cleared. */
export function toArmed(prev: TwinDraftSnapshot, tabId: number, tabUrl: string | null): TwinDraftSnapshot {
  return {
    ...prev,
    phase: 'armed',
    tabId,
    tabUrl,
    target: null,
    lastDraft: null,
    error: null,
    confirmingSubmit: false,
  };
}

/** The user clicked a box (or asked for a regenerate into the remembered one). */
export function toDrafting(prev: TwinDraftSnapshot, target: PickedTarget): TwinDraftSnapshot {
  return { ...prev, phase: 'drafting', target, error: null, confirmingSubmit: false };
}

export function toInserted(prev: TwinDraftSnapshot, draft: string): TwinDraftSnapshot {
  return { ...prev, phase: 'inserted', lastDraft: draft, error: null };
}

export function toFailed(prev: TwinDraftSnapshot, message: string): TwinDraftSnapshot {
  return { ...prev, phase: 'failed', error: message, confirmingSubmit: false };
}

/**
 * Back to nothing-bound. `steer` and `directions` are the user's standing
 * preference for the next draft, not page state, so they survive a reset.
 */
export function toIdle(prev: TwinDraftSnapshot): TwinDraftSnapshot {
  return { ...EMPTY, steer: prev.steer, directions: prev.directions };
}

/**
 * Follow the tab list Rust announced. The remembered tab going away, or its
 * url moving, kills the page's refs — so the lane lets go. Same snapshot back
 * when nothing relevant moved, so subscribers are not woken for nothing.
 */
export function followTabs(prev: TwinDraftSnapshot, tabs: readonly BrowserTab[]): TwinDraftSnapshot {
  if (prev.phase === 'idle' || prev.tabId === null) return prev;
  const tab = tabs.find((candidate) => candidate.id === prev.tabId);
  if (!tab) return toIdle(prev);
  // Armed before the store had seen the tab (a cold mount): the first sighting
  // BINDS the url rather than counting as a move away from nothing.
  if (prev.tabUrl === null) return { ...prev, tabUrl: tab.url };
  if (tab.url !== prev.tabUrl) return toIdle(prev);
  return prev;
}

/** What the twin drafts against: the picked target WITHOUT its ref. */
export function pageContextOf(target: PickedTarget): TwinPageContext {
  const { ref: _ref, ...page } = target;
  return page;
}

/** The contact handle an insert is filed under — the page's host, or the whole url if it has none. */
export function contactHandleOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** The registry-resolved message for any rejection — structured `AppError`, `Error` or a bare string. */
export function messageOf(err: unknown): string {
  const raw = isTauriError(err) ? err.error : err instanceof Error ? err.message : String(err);
  return resolveError(raw).message;
}

// --- module singleton ---------------------------------------------------------

let state: TwinDraftSnapshot = EMPTY;
/** Minted per arm / regenerate / submit and bumped on reset, so an abandoned run cannot write back. */
const runs = createLatestWins();

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeTwinDraft(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The snapshot getter `useSyncExternalStore` compares by identity. */
export function twinDraftSnapshot(): TwinDraftSnapshot {
  return state;
}

function commit(next: TwinDraftSnapshot): void {
  if (next === state) return;
  state = next;
  for (const listener of [...listeners]) listener();
}

/** Test-only reset hatch. */
export function resetTwinDraftLane(): void {
  runs.next();
  stopFollowingTabs();
  state = EMPTY;
  for (const listener of [...listeners]) listener();
}

// --- tab following ------------------------------------------------------------

let unfollowTabs: (() => void) | null = null;

/**
 * Adopt a tab list. Called by the browser store subscription, and directly by
 * tests — the lane's navigation rule must be provable without the store.
 */
export function noteTabs(tabs: readonly BrowserTab[]): void {
  const next = followTabs(state, tabs);
  if (next !== state) {
    runs.next();
    commit(next);
  }
}

function startFollowingTabs(): void {
  if (unfollowTabs) return;
  unfollowTabs = subscribeBrowser(() => noteTabs(browserSnapshot().tabs));
}

function stopFollowingTabs(): void {
  unfollowTabs?.();
  unfollowTabs = null;
}

// --- the flow -----------------------------------------------------------------

/**
 * Draft for the remembered target, type it into the box, record it. Runs
 * under `gen`; abandons silently when the lane has moved on underneath it.
 */
async function draftAndFill(gen: number, twinId: string, tabId: number, target: PickedTarget): Promise<void> {
  try {
    const result = await twinApi.draftForPage(
      twinId,
      pageContextOf(target),
      state.directions.trim() || undefined,
      state.steer ?? undefined,
    );
    if (!runs.isCurrent(gen)) return;
    await browserApi.fillTarget(tabId, target.ref, result.draft);
    if (!runs.isCurrent(gen)) return;
    commit(toInserted(state, result.draft));
    // The text is already in the box: a failed ledger write is telemetry, not
    // a failed insert, and telling the user "failed" over a draft they can see
    // would be a lie. Sentry + console, no state change.
    twinApi
      .recordInteraction(
        twinId,
        BROWSER_CHANNEL,
        'out',
        result.draft,
        contactHandleOf(target.url),
        undefined,
        undefined,
        false,
      )
      .catch(silentCatch('twin browser record interaction'));
  } catch (err) {
    if (!runs.isCurrent(gen)) return;
    commit(toFailed(state, messageOf(err)));
  }
}

/**
 * Arm the page and wait for the user's click. A second arm while one is
 * pending is a no-op — the page is already listening. Arming while drafting is
 * refused too: the box is about to be written and a new pick mid-write would
 * race it.
 */
export async function arm(tabId: number, twinId: string): Promise<void> {
  if (state.phase === 'armed' || state.phase === 'drafting') return;
  startFollowingTabs();
  const gen = runs.next();
  const tabUrl = browserSnapshot().tabs.find((tab) => tab.id === tabId)?.url ?? null;
  commit(toArmed(state, tabId, tabUrl));

  let target: PickedTarget;
  try {
    target = await browserApi.pickTarget(tabId);
  } catch (err) {
    if (!runs.isCurrent(gen)) return;
    // The user (or a navigation) disarmed the page: silence, not failure.
    commit(browserApi.isPickCancelled(err) ? toIdle(state) : toFailed(state, messageOf(err)));
    return;
  }
  if (!runs.isCurrent(gen)) return;
  commit(toDrafting(state, target));
  await draftAndFill(gen, twinId, tabId, target);
}

/** Disarm a pending pick. Idle either way; the page's own answer is ignored. */
export async function cancel(tabId: number): Promise<void> {
  runs.next();
  commit(toIdle(state));
  await browserApi.pickCancel(tabId).catch(silentCatch('twin browser pick cancel'));
}

/**
 * Re-draft into the remembered box. Requires a target — there is nothing to
 * regenerate into before the first pick, and nothing after a navigation.
 */
export async function regenerate(twinId: string, steer?: TwinSteer | null, directions?: string): Promise<void> {
  const { target, tabId } = state;
  if (!target || tabId === null || state.phase === 'drafting' || state.phase === 'armed') return;
  const gen = runs.next();
  commit(
    toDrafting(
      {
        ...state,
        steer: steer === undefined ? state.steer : steer,
        directions: directions === undefined ? state.directions : directions,
      },
      target,
    ),
  );
  await draftAndFill(gen, twinId, tabId, target);
}

/** Show the inline "Submit the form?" one-liner. Only meaningful once a draft is in the box. */
export function requestSubmit(): void {
  if (state.phase !== 'inserted') return;
  commit({ ...state, confirmingSubmit: true });
}

export function dismissSubmit(): void {
  if (!state.confirmingSubmit) return;
  commit({ ...state, confirmingSubmit: false });
}

/**
 * Press the form's own submit control. Success returns the lane to idle: the
 * page will almost certainly navigate, and even when it does not the draft has
 * left the box's ownership.
 */
export async function confirmSubmit(tabId: number): Promise<void> {
  const { target } = state;
  if (!target || state.phase !== 'inserted') return;
  const gen = runs.next();
  commit({ ...state, confirmingSubmit: false });
  try {
    await browserApi.submitTarget(tabId, target.ref);
    if (!runs.isCurrent(gen)) return;
    commit(toIdle(state));
  } catch (err) {
    if (!runs.isCurrent(gen)) return;
    commit(toFailed(state, messageOf(err)));
  }
}

export function setDirections(directions: string): void {
  if (directions === state.directions) return;
  commit({ ...state, directions });
}

export function setSteer(steer: TwinSteer | null): void {
  if (steer === state.steer) return;
  commit({ ...state, steer });
}
