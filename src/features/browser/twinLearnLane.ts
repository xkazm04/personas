// Twin learn lane — the ONE copy of "where the Learn icon stands" for the
// Browser webview route (spark twin-portable-blueprint).
//
// Same doctrine as `twinDraftLane.ts`: a module singleton that mutates
// synchronously, notifies subscribers, and exports its transitions as pure
// functions so the reducer is testable without a Tauri bridge. A module store
// because a remount of the route (nav away and back) must find the captured
// sample still waiting for its Teach / New twin answer.
//
// THE FLOW. `capture` reads what the user highlighted on the tab
// (`browser_webview_capture_selection`, the `page_selection` hand). A strict
// page CSP, a non-whitelisted origin, or a tab with no hand yet rejects; an
// empty selection resolves with `text: ""`. Either way the lane falls back to
// the OS clipboard, read ONCE because the user pressed Learn (never watched).
// Both empty is `failed`. A captured sample waits in `choosing` for one of:
//   - Teach <active twin>: `learnFromSample` stores it and returns at once with
//     status `analyzing`; the analysis announces itself with
//     `twin-sample-updated`, on which the lane settles to `done` (with the
//     proposal count) or `failed` (refused / analysis failed).
//   - New twin: hands the sample to the forge (`openTwinExperience` with a
//     `seedSample`); the forge learns from it right after creating the twin,
//     so the lane lets go at once.
//
// STALENESS GUARD. Every async step carries a `createLatestWins()` token and
// re-checks it after each await (golden path stale-response-guard): a cancel,
// a second Learn or a reset mints a newer token, so a late answer from an
// abandoned run cannot overwrite a newer state.
import * as browserApi from '@/api/browser';
import * as twinSample from '@/api/twin/twinSample';
import type { TwinSampleUpdatedEvent } from '@/lib/bindings/TwinSampleUpdatedEvent';
import { EventName, typedListen } from '@/lib/eventRegistry';
import { silentCatch } from '@/lib/silentCatch';
import { createLatestWins } from '@/stores/util/latestWins';
import { openTwinExperience } from '@/features/plugins/twin/experience/launcher';

import { browserSnapshot } from './browserStore';
import { messageOf } from './twinDraftLane';

export type TwinLearnPhase = 'idle' | 'capturing' | 'choosing' | 'learning' | 'done' | 'failed';

/** Where a captured sample came from. A forge-seeded sample is recorded by the forge as `forge`. */
export type TwinLearnSource = 'selection' | 'clipboard';

/**
 * Why the lane failed, as a token the row renders (never a sentence here):
 * `capture` the page could not be read and the clipboard was empty too (CSP,
 * hand timeout), `nothing_selected` both reads succeeded and came back empty,
 * `refused` the twin declined the sample (`detail` = the reason), `analysis`
 * the background analysis failed, `error` a command rejected (`detail` = the
 * registry-resolved message).
 */
export type TwinLearnFailure = 'capture' | 'nothing_selected' | 'refused' | 'analysis' | 'error';

export interface TwinLearnSnapshot {
  phase: TwinLearnPhase;
  /** The tab Learn was pressed on, or null when no tab was open (clipboard only). */
  tabId: number | null;
  /** The captured sample, trimmed and capped to `SAMPLE_CAP`; `""` before a capture lands. */
  text: string;
  source: TwinLearnSource | null;
  /** The page's host for a selection; null for the clipboard. */
  host: string | null;
  words: number;
  /** The twin taught, while learning and after. */
  twinId: string | null;
  sampleId: string | null;
  /** Proposals the analysis produced, on `done`. */
  proposals: number | null;
  failure: TwinLearnFailure | null;
  detail: string | null;
}

/** The same cap the Rust side applies (`SELECTION_CAP`, `twin_clipboard_text`). */
export const SAMPLE_CAP = 8000;

const EMPTY: TwinLearnSnapshot = {
  phase: 'idle',
  tabId: null,
  text: '',
  source: null,
  host: null,
  words: 0,
  twinId: null,
  sampleId: null,
  proposals: null,
  failure: null,
  detail: null,
};

// --- pure helpers ---------------------------------------------------------------

/** Trim, then cap. A whitespace-only read is empty. */
export function clipSample(raw: string | null | undefined): string {
  return (raw ?? '').trim().slice(0, SAMPLE_CAP);
}

/** Whitespace-separated words; good enough for "n words from host". */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** The host of a url, or null when it has none or does not parse. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch (err) {
    silentCatch('twin learn host of url')(err);
    return null;
  }
}

// --- pure transitions -------------------------------------------------------------

export function toCapturing(tabId: number | null): TwinLearnSnapshot {
  return { ...EMPTY, phase: 'capturing', tabId };
}

export function toChoosing(
  prev: TwinLearnSnapshot,
  text: string,
  source: TwinLearnSource,
  host: string | null,
): TwinLearnSnapshot {
  return { ...prev, phase: 'choosing', text, source, host, words: countWords(text), failure: null, detail: null };
}

export function toLearning(prev: TwinLearnSnapshot, twinId: string): TwinLearnSnapshot {
  return { ...prev, phase: 'learning', twinId, sampleId: null, proposals: null, failure: null, detail: null };
}

export function toDone(prev: TwinLearnSnapshot, proposals: number): TwinLearnSnapshot {
  return { ...prev, phase: 'done', proposals, failure: null, detail: null };
}

export function toLearnFailed(
  prev: TwinLearnSnapshot,
  failure: TwinLearnFailure,
  detail: string | null = null,
): TwinLearnSnapshot {
  return { ...prev, phase: 'failed', failure, detail };
}

/**
 * Settle a learning lane on its sample's event. Same snapshot back for an
 * event about another sample, or a status that is not terminal.
 */
export function settleOnEvent(prev: TwinLearnSnapshot, event: TwinSampleUpdatedEvent): TwinLearnSnapshot {
  if (prev.phase !== 'learning' || prev.sampleId === null || event.sampleId !== prev.sampleId) return prev;
  switch (event.status) {
    case 'ready':
      return toDone(prev, event.proposals);
    case 'refused':
      return toLearnFailed(prev, 'refused');
    case 'failed':
      return toLearnFailed(prev, 'analysis');
    default:
      return prev;
  }
}

// --- module singleton -------------------------------------------------------------

let state: TwinLearnSnapshot = EMPTY;
const runs = createLatestWins();
/** Events that arrived before `learnFromSample` told the lane its sample id. */
const early = new Map<string, TwinSampleUpdatedEvent>();

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeTwinLearn(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The snapshot getter `useSyncExternalStore` compares by identity. */
export function twinLearnSnapshot(): TwinLearnSnapshot {
  return state;
}

function commit(next: TwinLearnSnapshot): void {
  if (next === state) return;
  state = next;
  if (state.phase !== 'learning') stopListening();
  for (const listener of [...listeners]) listener();
}

/** Test-only reset hatch. */
export function resetTwinLearnLane(): void {
  runs.next();
  early.clear();
  stopListening();
  state = EMPTY;
  for (const listener of [...listeners]) listener();
}

// --- the sample event subscription (alive only while learning) ------------------

let subscription: Promise<() => void> | null = null;

function startListening(): void {
  if (subscription) return;
  const pending = typedListen(EventName.TWIN_SAMPLE_UPDATED, (payload) => noteSampleUpdated(payload));
  subscription = pending;
  pending.catch(silentCatch('twin learn listen sample updates'));
}

function stopListening(): void {
  const pending = subscription;
  if (!pending) return;
  subscription = null;
  early.clear();
  // Registration is async: an unlisten requested before it resolved still runs.
  pending.then((unlisten) => unlisten()).catch(silentCatch('twin learn unlisten sample updates'));
}

/**
 * Adopt one `twin-sample-updated` payload. Called by the subscription, and
 * directly by tests — settling must be provable without the event bus. A
 * terminal refusal or failure fetches the sample once for its reason.
 */
export function noteSampleUpdated(event: TwinSampleUpdatedEvent): void {
  if (state.phase !== 'learning') return;
  if (state.sampleId === null) {
    early.set(event.sampleId, event);
    return;
  }
  const next = settleOnEvent(state, event);
  if (next === state) return;
  commit(next);
  if (next.phase === 'failed' && next.twinId) void attachReason(runs.current(), next.twinId, event.sampleId);
}

/** Look up why a sample was refused or failed and put it on the failed row. */
async function attachReason(gen: number, twinId: string, sampleId: string): Promise<void> {
  try {
    const samples = await twinSample.sampleList(twinId);
    if (!runs.isCurrent(gen) || state.phase !== 'failed' || state.sampleId !== sampleId) return;
    const reason = (samples ?? []).find((s) => s.id === sampleId)?.error?.trim();
    if (reason) commit({ ...state, detail: reason });
  } catch (err) {
    silentCatch('twin learn sample reason')(err);
  }
}

// --- the flow ---------------------------------------------------------------------

/**
 * Read the selection on `tabId` (when there is a tab), fall back to the
 * clipboard, and wait in `choosing`. Pressing Learn again restarts the read.
 */
export async function capture(tabId: number | null): Promise<void> {
  const gen = runs.next();
  commit(toCapturing(tabId));

  let pageFailed = false;
  if (tabId !== null) {
    try {
      const selection = await browserApi.captureSelection(tabId);
      if (!runs.isCurrent(gen)) return;
      const text = clipSample(selection?.text);
      if (text) {
        // The hand reports the page's host; the tab's url is the fallback for
        // a page that answered without one.
        const tabUrl = browserSnapshot().tabs.find((tab) => tab.id === tabId)?.url;
        const host = selection.host ?? hostOf(selection.url) ?? hostOf(tabUrl);
        commit(toChoosing(state, text, 'selection', host));
        return;
      }
    } catch (err) {
      if (!runs.isCurrent(gen)) return;
      // Expected on a CSP-locked or non-whitelisted page: telemetry, then the clipboard.
      silentCatch('twin learn capture selection')(err);
      pageFailed = true;
    }
  }

  let clipboardFailed = false;
  try {
    const text = clipSample(await twinSample.clipboardText());
    if (!runs.isCurrent(gen)) return;
    if (text) {
      commit(toChoosing(state, text, 'clipboard', null));
      return;
    }
  } catch (err) {
    if (!runs.isCurrent(gen)) return;
    silentCatch('twin learn clipboard read')(err);
    clipboardFailed = true;
  }
  commit(toLearnFailed(state, pageFailed || clipboardFailed ? 'capture' : 'nothing_selected'));
}

/** Teach the captured sample to `twinId`. Only from `choosing`. */
export async function teach(twinId: string): Promise<void> {
  if (state.phase !== 'choosing' || !state.source) return;
  const gen = runs.next();
  const { text, source, host } = state;
  early.clear();
  commit(toLearning(state, twinId));
  // Subscribe BEFORE the call: a fast analysis can announce itself before the
  // invoke resolves, and `early` holds that event until the id is known.
  startListening();
  try {
    const sample = await twinSample.learnFromSample(twinId, text, source, host);
    if (!runs.isCurrent(gen)) return;
    commit({ ...state, sampleId: sample.id });
    const buffered = early.get(sample.id);
    early.clear();
    if (buffered) noteSampleUpdated(buffered);
  } catch (err) {
    if (!runs.isCurrent(gen)) return;
    commit(toLearnFailed(state, 'error', messageOf(err)));
  }
}

/**
 * Hand the captured sample to the forge: it creates the twin, then learns from
 * the sample on the new id. The lane's part is over the moment it hands off.
 */
export function newTwin(): void {
  if (state.phase !== 'choosing' || !state.source) return;
  openTwinExperience({
    mode: 'create',
    seedSample: { text: state.text, sourceKind: state.source, sourceHost: state.host },
  });
  runs.next();
  commit(EMPTY);
}

/** Drop whatever the lane holds. A learning run keeps going in the background; the Hub shows it. */
export function dismissLearn(): void {
  runs.next();
  commit(EMPTY);
}
