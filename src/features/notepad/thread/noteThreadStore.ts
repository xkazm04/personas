// The per-note THREAD — reviews, comments and milestones from Athena, the
// note-task agent, the system and the operator — as one module store.
//
// Same shape as `notepadStore.ts`: a module singleton that mutates in memory,
// notifies subscribers, and hands `useSyncExternalStore` the SAME container
// until something writes. Two kinds of state live here and they are cached
// differently on purpose:
//
//   - UNREAD COUNTS for every note. Small, whole-desk, read by every card —
//     a plain record behind a cached snapshot.
//   - THREADS, one per note, fetched only when a popover opens. Multi-entry and
//     keyed by an entity id, so it is a `createModuleCache` with a named cap
//     rather than a hand-rolled Map (CLAUDE.md § Cold-load, mechanic 4).
//
// The server is the authority for `read_at`. The counts here are a projection
// kept live by `notepad-note-comment` events between two reads of
// `notepad_unread_counts`, never a second source of truth.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';

import * as notepadApi from '@/api/notepad';
import { createModuleCache, useModuleSubscription } from '@/hooks/utility/data/useModuleSubscription';
import type { NoteComment } from '@/lib/bindings/NoteComment';
import { EventName, typedListen } from '@/lib/eventRegistry';
import { silentCatch } from '@/lib/silentCatch';

/** One note's thread as the popover reads it. */
export interface NoteThreadState {
  /** Oldest first — the order the server lists and the popover renders. */
  entries: readonly NoteComment[];
  /** A fetch is in flight. The popover ghosts only while this is true AND
   *  `entries` is empty (loading v2, law 1: a fetch never hides rows). */
  loading: boolean;
  /** The last read FAILED — `entries` is then the last good reading (possibly
   *  empty), and "no comments yet" would be a claim nothing observed. */
  failed: boolean;
}

/** Threads resident at once. A desk holds ten notes; sixteen covers a session
 *  of popovers opened across archived and shipped notes too. */
export const THREAD_CACHE_MAX = 16;

const EMPTY_ENTRIES: readonly NoteComment[] = Object.freeze([]);
const IDLE_THREAD: NoteThreadState = Object.freeze({ entries: EMPTY_ENTRIES, loading: false, failed: false });
/** A thread that has never been read: loading until the first fetch settles. */
const UNREAD_THREAD: NoteThreadState = Object.freeze({ entries: EMPTY_ENTRIES, loading: true, failed: false });

const threads = createModuleCache<string, NoteThreadState>({ maxSize: THREAD_CACHE_MAX });

// --- unread counts ------------------------------------------------------------

let unread: Record<string, number> = {};
/** The newest unread entry per note — the bubble candidate. */
let latestUnread: Record<string, string> = {};
/** The note whose thread is on screen right now (popover open). An entry that
 *  arrives for it is read the moment it lands, so it never bumps a count the
 *  operator is looking straight at. */
let viewing: string | null = null;
/** Ids already counted, so an event replayed after a fetch (or a fetch that
 *  returns a row an event already delivered) never counts twice. Bounded: it
 *  only has to outlive the race between one event and one read. */
const seen = new Set<string>();
const SEEN_CAP = 500;

type Listener = () => void;
const listeners = new Set<Listener>();
let unreadCache: Readonly<Record<string, number>> | null = null;

function emit(): void {
  unreadCache = null;
  for (const l of [...listeners]) l();
}

export function subscribeNoteThreads(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const unreadSnapshot = (): Readonly<Record<string, number>> => (unreadCache ??= { ...unread });

export function unreadCountOf(noteId: string | null | undefined): number {
  return noteId ? unread[noteId] ?? 0 : 0;
}

/** The newest unread entry's id for a note, or `null` when nothing is unread. */
export function latestUnreadIdOf(noteId: string | null | undefined): string | null {
  return noteId ? latestUnread[noteId] ?? null : null;
}

function remember(id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > SEEN_CAP) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  return true;
}

/** An entry that counts toward the unread badge. The operator's own comments
 *  are born read server-side; the `authorKind` check is the belt to that. */
function countsAsUnread(c: NoteComment): boolean {
  return c.readAt === null && c.authorKind !== 'operator';
}

/**
 * Read every note's unread count. Called when the pad loads its notes.
 *
 * Whole-map replace: a note absent from the answer has nothing unread, and a
 * per-note merge would keep a count for a thread that was read elsewhere.
 */
export async function loadThreadUnread(): Promise<void> {
  try {
    const rows = await notepadApi.noteUnreadCounts();
    // INVARIANT: the IPC answer is typed by the wrapper, but a stubbed backend
    // (tests, a half-built command) can hand back anything — treat a non-array
    // as "no reading" rather than as "nothing unread".
    if (!Array.isArray(rows)) return;
    unread = {};
    latestUnread = {};
    for (const r of rows) {
      if (r.unread > 0) unread[r.noteId] = r.unread;
      if (r.latestId) latestUnread[r.noteId] = r.latestId;
    }
    if (viewing) {
      delete unread[viewing];
      delete latestUnread[viewing];
    }
    emit();
  } catch (e) {
    silentCatch('notepad thread unread counts')(e);
  }
}

// --- threads ------------------------------------------------------------------

const inFlight = new Map<string, Promise<void>>();

function mergeEntries(a: readonly NoteComment[], b: readonly NoteComment[]): NoteComment[] {
  const byId = new Map<string, NoteComment>();
  for (const c of a) byId.set(c.id, c);
  // `b` wins: it is the newer reading of the same row (a verdict stamped, a
  // read_at set).
  for (const c of b) byId.set(c.id, c);
  return [...byId.values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt));
}

// --- run outcomes -------------------------------------------------------------
//
// A `run` review row does not carry its outcome. The ingest writes a
// `system`/`status` row with ref_id `completed` | `failed` IMMEDIATELY before
// each run review (notepad_ingest.rs post_run_thread), so the outcome is the
// nearest preceding status row. Indexed by review id from both doors: a loaded
// thread (ordering) and the live feed (arrival order).
const runOutcomes = new Map<string, 'completed' | 'failed'>();
const lastStatusByNote = new Map<string, 'completed' | 'failed'>();

function outcomeToken(c: NoteComment): 'completed' | 'failed' | null {
  return c.kind === 'system' && (c.refId === 'completed' || c.refId === 'failed') ? c.refId : null;
}

function indexRunOutcomes(entries: readonly NoteComment[]): void {
  let last: 'completed' | 'failed' | null = null;
  for (const c of entries) {
    const tok = outcomeToken(c);
    if (tok) last = tok;
    else if (c.kind === 'review' && c.refKind === 'run' && last) runOutcomes.set(c.id, last);
  }
}

function noteRunOutcome(c: NoteComment): void {
  const tok = outcomeToken(c);
  if (tok) {
    lastStatusByNote.set(c.noteId, tok);
    return;
  }
  if (c.kind === 'review' && c.refKind === 'run' && !runOutcomes.has(c.id)) {
    const last = lastStatusByNote.get(c.noteId);
    if (last) runOutcomes.set(c.id, last);
  }
}

/** The outcome of the run a `run` review answers for, when known. */
export function runOutcomeFor(reviewId: string): 'completed' | 'failed' | undefined {
  return runOutcomes.get(reviewId);
}

function setThread(noteId: string, next: NoteThreadState): void {
  threads.set(noteId, next);
  indexRunOutcomes(next.entries);
  threads.notify();
}

/** The cached thread for a note, or `undefined` when it has never been read. */
export function threadOf(noteId: string): NoteThreadState | undefined {
  return threads.get(noteId);
}

/**
 * Read one note's thread. De-duplicated per note: a second call while one is in
 * flight awaits the first.
 *
 * Entries that arrived by event DURING the read are merged, not overwritten —
 * the read may have been answered before the row was committed.
 */
export function fetchThread(noteId: string): Promise<void> {
  const running = inFlight.get(noteId);
  if (running) return running;
  const prev = threads.get(noteId);
  setThread(noteId, { entries: prev?.entries ?? EMPTY_ENTRIES, loading: true, failed: false });
  const p = (async () => {
    try {
      const rows = await notepadApi.listNoteComments(noteId);
      for (const r of rows) remember(r.id);
      const during = threads.get(noteId)?.entries ?? EMPTY_ENTRIES;
      setThread(noteId, { entries: mergeEntries(during, rows), loading: false, failed: false });
    } catch (e) {
      silentCatch('notepad thread fetch')(e);
      setThread(noteId, { entries: threads.get(noteId)?.entries ?? EMPTY_ENTRIES, loading: false, failed: true });
    } finally {
      inFlight.delete(noteId);
    }
  })();
  inFlight.set(noteId, p);
  return p;
}

/**
 * Stamp one note's thread read. Optimistic: the badge drops to zero now and the
 * cached entries carry a `readAt`, then the server is told. A failed write
 * restores the count — a badge that vanished on a write that did not land would
 * be a thread the operator believes he has read and the server says he has not.
 */
export async function markThreadRead(noteId: string): Promise<void> {
  const prevCount = unread[noteId] ?? 0;
  const prevLatest = latestUnread[noteId];
  const cached = threads.get(noteId);
  const hasUnreadCached = !!cached?.entries.some(countsAsUnread);
  if (prevCount === 0 && !hasUnreadCached) return;

  const now = new Date().toISOString();
  if (prevCount > 0 || prevLatest) {
    const { [noteId]: _c, ...restCounts } = unread;
    const { [noteId]: _l, ...restLatest } = latestUnread;
    unread = restCounts;
    latestUnread = restLatest;
    emit();
  }
  if (cached && hasUnreadCached) {
    setThread(noteId, {
      ...cached,
      entries: cached.entries.map((c) => (c.readAt === null ? { ...c, readAt: now } : c)),
    });
  }
  try {
    await notepadApi.markNoteCommentsRead(noteId);
  } catch (e) {
    silentCatch('notepad thread mark read')(e);
    if (prevCount > 0) {
      unread = { ...unread, [noteId]: prevCount };
      if (prevLatest) latestUnread = { ...latestUnread, [noteId]: prevLatest };
      emit();
    }
  }
}

/**
 * Tell the store which thread is on screen (`null` when the popover closes).
 *
 * While a thread is viewed, an entry arriving for it is read on arrival — the
 * count never bumps for something the operator is looking at.
 */
export function setViewingThread(noteId: string | null): void {
  viewing = noteId;
}

// --- incoming entries ---------------------------------------------------------

/** Metadata the bubble layer needs alongside the row. */
export interface NoteCommentArrival {
  comment: NoteComment;
  /** The note's unread count AFTER this entry was counted. */
  unread: number;
  /** True when the entry's thread was on screen as it landed. */
  viewed: boolean;
}

const arrivalSubs = new Set<(a: NoteCommentArrival) => void>();

/**
 * Subscribe to NEW thread entries by anyone but the operator — the bubble
 * layer's feed. Fires once per entry id (a replay or a verdict update to an
 * already-seen row does not re-fire). Returns the unsubscribe.
 */
export function onNoteComment(fn: (a: NoteCommentArrival) => void): () => void {
  arrivalSubs.add(fn);
  return () => {
    arrivalSubs.delete(fn);
  };
}

/**
 * Adopt one thread row — from the `notepad-note-comment` event, or from a
 * command's own answer (`addNoteComment`, `setNoteReviewVerdict`).
 *
 * An id already known is an UPDATE: the cached row is replaced and nothing is
 * counted or announced again.
 */
export function ingestNoteComment(comment: NoteComment): void {
  noteRunOutcome(comment);
  const fresh = remember(comment.id);
  const cached = threads.get(comment.noteId);
  const isViewed = viewing === comment.noteId;
  const row = isViewed && comment.readAt === null && comment.authorKind !== 'operator'
    ? { ...comment, readAt: new Date().toISOString() }
    : comment;

  if (cached) {
    setThread(comment.noteId, { ...cached, entries: mergeEntries(cached.entries, [row]) });
  }

  if (!fresh) return;

  if (countsAsUnread(comment)) {
    if (isViewed) {
      // The server still holds it unread; say so now rather than leaving a
      // count to reappear at the next load.
      void notepadApi.markNoteCommentsRead(comment.noteId).catch(silentCatch('notepad thread mark read (viewed)'));
    } else {
      unread = { ...unread, [comment.noteId]: (unread[comment.noteId] ?? 0) + 1 };
      latestUnread = { ...latestUnread, [comment.noteId]: comment.id };
      emit();
    }
  }

  if (comment.authorKind === 'operator') return;
  const arrival: NoteCommentArrival = {
    comment: row,
    unread: unread[comment.noteId] ?? 0,
    viewed: isViewed,
  };
  for (const fn of [...arrivalSubs]) fn(arrival);
}

// --- live wiring --------------------------------------------------------------

// HMR-safe once-per-process latch, the same shape as notepadStore's
// `__personasNotepadListeners`: a re-evaluated module must not attach a second
// listener that would count every entry twice.
const LISTENER_KEY = '__personasNoteThreadListeners';
interface ListenerFlag {
  started: boolean;
  unlisten: UnlistenFn[];
}
type ListenerHost = typeof globalThis & { [LISTENER_KEY]?: ListenerFlag };
const listenerFlag = (): ListenerFlag => ((globalThis as ListenerHost)[LISTENER_KEY] ??= { started: false, unlisten: [] });

/** Attach the `notepad-note-comment` listener. Idempotent. */
export function startNoteThreadListeners(): void {
  const flag = listenerFlag();
  if (flag.started) return;
  flag.started = true;
  void typedListen(EventName.NOTEPAD_NOTE_COMMENT, (payload) => {
    ingestNoteComment(payload);
  }).then((un) => flag.unlisten.push(un));
}

// --- hooks --------------------------------------------------------------------

/** Every note's unread count (absent = zero). One subscription for a grid. */
export function useNoteUnreadMap(): Readonly<Record<string, number>> {
  return useSyncExternalStore(subscribeNoteThreads, unreadSnapshot, unreadSnapshot);
}

/** One note's unread count. */
export function useNoteUnread(noteId: string | null | undefined): number {
  const get = useCallback(() => unreadCountOf(noteId), [noteId]);
  return useSyncExternalStore(subscribeNoteThreads, get, get);
}

/**
 * One note's thread. Fetches on mount (and when `noteId` changes) if the thread
 * has never been read; a cached thread paints warm and is kept live by events,
 * so a reopened popover never re-ghosts.
 *
 * `loading` is true until the first read settles — render the ghost only while
 * `loading && entries.length === 0`.
 */
export function useNoteThread(noteId: string | null | undefined): NoteThreadState {
  const state = useModuleSubscription(threads, noteId ?? '');
  useEffect(() => {
    if (!noteId) return;
    if (!threads.get(noteId)) void fetchThread(noteId);
  }, [noteId]);
  if (!noteId) return IDLE_THREAD;
  return state ?? UNREAD_THREAD;
}

// --- test hatch ---------------------------------------------------------------

export function __resetNoteThreadStoreForTests(): void {
  threads.invalidateAll();
  inFlight.clear();
  unread = {};
  latestUnread = {};
  viewing = null;
  seen.clear();
  arrivalSubs.clear();
  const flag = listenerFlag();
  flag.started = false;
  flag.unlisten = [];
  emit();
}
