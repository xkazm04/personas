// Notepad module store — the ONE mutable copy of the note set for the whole
// app, plus the crash-safety machinery around it.
//
// Shape and doctrine are lifted from `teams/sub_mastermind/lib/layoutStore.ts`:
// a module singleton that mutates in memory synchronously, notifies
// subscribers, and schedules a debounced write-through. Views read through
// `useSyncExternalStore` against snapshot getters that hand back the SAME
// container until something writes, which is what makes an out-of-band change
// (the Tauri sweeper flipping a status) paint without anyone polling.
//
// ---------------------------------------------------------------------------
// THREE STORAGE TIERS, AND WHY
// ---------------------------------------------------------------------------
//   1. MEMORY (this module)   — what the editor renders. Updated synchronously
//                               on every keystroke, so typing never waits.
//   2. localStorage SHADOW    — `personas.notepad.shadow.<noteId>` holding
//                               `{ bodyMd, title, updatedAt }`. Written
//                               SYNCHRONOUSLY in the same call as the memory
//                               update, BEFORE the debounce is scheduled. This
//                               is the tier that exists for the 500ms window in
//                               which the app can die: a crash, a WebView
//                               reload, a `tauri dev` restart. Without it those
//                               keystrokes are simply gone.
//   3. SQLite (via `notepad_update_note`) — the durable copy. Written on a
//                               per-note 500ms debounce, and the shadow is
//                               cleared only once the row confirms it holds
//                               what memory holds.
//
// The shadow is NOT a cache and must never be read as one: it is only ever
// consulted at `load()`, and only when its `updatedAt` is NEWER than the row's.
// A shadow older than the row is a leftover from a save that did land, and is
// dropped.
import type { UnlistenFn } from '@tauri-apps/api/event';

import * as notepadApi from '@/api/notepad';
import { NOTE_CAP } from '@/api/notepad';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';
import { mapWithConcurrency } from '@/lib/concurrency';
import { EventName, typedListen } from '@/lib/eventRegistry';
import { safeLocalGet, safeLocalRemove, safeLocalSet } from '@/lib/safeLocalStorage';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

export { NOTE_CAP };

/** Per-note save lifecycle, rendered as the tab's save dot. */
export type NoteSaveState = 'clean' | 'dirty' | 'saving' | 'error';

/** Debounce window for the durable write. Same 500ms the canvas layout uses:
 *  long enough to coalesce a burst of typing, short enough that the shadow is
 *  only ever covering half a second of work. */
export const SAVE_DEBOUNCE_MS = 500;

/** localStorage key for one note's crash shadow. */
export const shadowKey = (noteId: string) => `personas.notepad.shadow.${noteId}`;

/** What a shadow carries — the two fields a user can lose by typing. */
export interface NoteShadow {
  bodyMd: string;
  title: string;
  /** ISO stamp of the edit, compared against the row's `updatedAt` on load. */
  updatedAt: string;
}

export interface NotePatch {
  title?: string;
  bodyMd?: string;
  projectId?: string | null;
}

// --- module singletons --------------------------------------------------------

let notes: Record<string, DevNote> = {};
let order: string[] = [];
let saveStates: Record<string, NoteSaveState> = {};
let loading = false;
let loaded = false;

/** Pending debounce timer per note id. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** In-flight save promise per note id, so `flush` can await a save already running. */
const inFlight = new Map<string, Promise<void>>();

// --- subscription -------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

interface SnapshotCache {
  notes?: Readonly<Record<string, DevNote>>;
  order?: readonly string[];
  saveStates?: Readonly<Record<string, NoteSaveState>>;
  status?: Readonly<{ loading: boolean; loaded: boolean }>;
}
let cache: SnapshotCache = {};

export function subscribeNotepad(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  cache = {};
  for (const l of [...listeners]) l();
}

// --- snapshots ----------------------------------------------------------------

export const notesSnapshot = (): Readonly<Record<string, DevNote>> => (cache.notes ??= { ...notes });
export const orderSnapshot = (): readonly string[] => (cache.order ??= [...order]);
export const saveStatesSnapshot = (): Readonly<Record<string, NoteSaveState>> =>
  (cache.saveStates ??= { ...saveStates });
export const statusSnapshot = (): Readonly<{ loading: boolean; loaded: boolean }> =>
  (cache.status ??= { loading, loaded });

/** Notes in tab order, archived excluded — what the tab strip renders. */
export function openNotes(): DevNote[] {
  return order.map((id) => notes[id]).filter((n): n is DevNote => !!n && n.status !== 'archived');
}

/** Archived notes, newest-archived first — what the archive modal renders. */
export function archivedNotes(): DevNote[] {
  return order
    .map((id) => notes[id])
    .filter((n): n is DevNote => !!n && n.status === 'archived')
    .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
}

export function getNote(id: string | null | undefined): DevNote | undefined {
  return id ? notes[id] : undefined;
}

export function saveStateOf(id: string): NoteSaveState {
  return saveStates[id] ?? 'clean';
}

/** True when a new note would exceed the server's non-archived cap. The `+`
 *  button greys out on this; the server refuses regardless. */
export function atCap(): boolean {
  return openNotes().length >= NOTE_CAP;
}

// --- shadow tier --------------------------------------------------------------

function readShadow(noteId: string): NoteShadow | null {
  const raw = safeLocalGet(shadowKey(noteId), 'notepad shadow read');
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    // INVARIANT for the narrowing: this blob came back from localStorage, so
    // its real type is `unknown` — an older build (or a hand-edited value)
    // could have written anything. Every field is checked before it is trusted.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const p = parsed as Partial<NoteShadow>;
    if (typeof p.bodyMd !== 'string' || typeof p.title !== 'string' || typeof p.updatedAt !== 'string') {
      return null;
    }
    return { bodyMd: p.bodyMd, title: p.title, updatedAt: p.updatedAt };
  } catch {
    return null;
  }
}

function writeShadow(note: DevNote): void {
  const shadow: NoteShadow = {
    bodyMd: note.bodyMd,
    title: note.title,
    updatedAt: new Date().toISOString(),
  };
  // A full or blocked storage costs the crash guarantee, never the edit.
  safeLocalSet(shadowKey(note.id), JSON.stringify(shadow), 'notepad shadow write');
}

function clearShadow(noteId: string): void {
  safeLocalRemove(shadowKey(noteId), 'notepad shadow clear');
}

// --- adopting server rows -----------------------------------------------------

function adopt(row: DevNote): void {
  notes = { ...notes, [row.id]: row };
  if (!order.includes(row.id)) order = [...order, row.id];
  emit();
}

function drop(noteId: string): void {
  const { [noteId]: _gone, ...rest } = notes;
  notes = rest;
  order = order.filter((id) => id !== noteId);
  const { [noteId]: _state, ...restStates } = saveStates;
  saveStates = restStates;
  emit();
}

function setSaveState(noteId: string, state: NoteSaveState): void {
  if (saveStates[noteId] === state) return;
  saveStates = { ...saveStates, [noteId]: state };
  emit();
}

// --- the single mutation door -------------------------------------------------

/**
 * The ONE way a note's editable fields change.
 *
 * Order is load-bearing and is the whole point of this function:
 *   1. memory  (synchronous — the editor renders from it)
 *   2. shadow  (synchronous — survives a crash in the next 500ms)
 *   3. debounce the durable save
 *
 * If 2 came after 3, the window it exists to cover would be the window it does
 * not cover.
 */
export function patchNote(id: string, patch: NotePatch): void {
  const current = notes[id];
  if (!current) return;

  const next: DevNote = {
    ...current,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.bodyMd !== undefined ? { bodyMd: patch.bodyMd } : {}),
    ...('projectId' in patch ? { projectId: patch.projectId ?? null } : {}),
  };
  notes = { ...notes, [id]: next };
  saveStates = { ...saveStates, [id]: 'dirty' };
  emit();

  writeShadow(next);
  scheduleSave(id);
}

function scheduleSave(id: string): void {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void runSave(id);
    }, SAVE_DEBOUNCE_MS),
  );
}

/** Persist one note now. Never rejects — a failure lands as `saveState:'error'`
 *  plus a toast carrying a retry, and the shadow is deliberately KEPT so the
 *  work is still recoverable after a reload. */
async function runSave(id: string): Promise<void> {
  const running = inFlight.get(id);
  if (running) return running;

  const note = notes[id];
  if (!note) return;
  const sent = { title: note.title, bodyMd: note.bodyMd, projectId: note.projectId };

  setSaveState(id, 'saving');
  const p = (async () => {
    try {
      const row = await notepadApi.updateNote(id, sent);
      adopt(row);
      // Compare what was SENT against what memory holds NOW. A keystroke that
      // landed while the IPC was in flight leaves the note genuinely dirty, and
      // calling it clean would drop that edit at the next flush — and clear the
      // shadow that was covering it.
      const after = notes[id];
      const settled =
        !!after &&
        after.title === sent.title &&
        after.bodyMd === sent.bodyMd &&
        after.projectId === sent.projectId;
      if (settled) {
        setSaveState(id, 'clean');
        clearShadow(id);
      } else {
        setSaveState(id, 'dirty');
        scheduleSave(id);
      }
    } catch (e) {
      setSaveState(id, 'error');
      toastCatch('notepad save')(e);
    } finally {
      inFlight.delete(id);
    }
  })();
  inFlight.set(id, p);
  return p;
}

/**
 * Force pending saves to run now and await them.
 *
 * Call before anything that would otherwise strand a debounce: switching tabs,
 * closing the overlay, deleting/archiving a note, and on `beforeunload` /
 * `pagehide`. With no argument it flushes every pending note.
 */
export async function flush(id?: string): Promise<void> {
  const ids = id ? [id] : [...new Set([...timers.keys(), ...inFlight.keys()])];
  // Bounded: a flush of every pending note must not open one IPC call per
  // note at once (bounded-parallel-fan-out); four is plenty for a ten-note pad.
  await mapWithConcurrency(ids, 4, async (noteId) => {
      const timer = timers.get(noteId);
      if (timer) {
        clearTimeout(timer);
        timers.delete(noteId);
        await runSave(noteId);
        return;
      }
      const running = inFlight.get(noteId);
      if (running) await running;
  });
}

/** Retry a failed save immediately (the toast action / the error dot's click). */
export async function retrySave(id: string): Promise<void> {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  await runSave(id);
}

// --- load + shadow reconciliation ---------------------------------------------

/**
 * Fetch every note (archived included — the archive modal reads the same set)
 * and reconcile each against its crash shadow.
 *
 * A shadow whose `updatedAt` is NEWER than the row's is unsaved work from a
 * session that died inside the debounce window: it is applied to memory and
 * saved through the ordinary door. Anything else is a leftover and is dropped.
 */
export async function load(): Promise<void> {
  loading = true;
  emit();
  try {
    const rows = await notepadApi.listNotes(true);
    const nextNotes: Record<string, DevNote> = {};
    const nextOrder: string[] = [];
    const recovered: string[] = [];

    for (const row of rows) {
      const shadow = readShadow(row.id);
      if (shadow && shadow.updatedAt > row.updatedAt && row.status === 'draft') {
        // Body/title edits are only legal on a draft, so a shadow against a
        // published note cannot be replayed — it would be refused server-side.
        nextNotes[row.id] = { ...row, bodyMd: shadow.bodyMd, title: shadow.title };
        recovered.push(row.id);
      } else {
        nextNotes[row.id] = row;
        if (shadow) clearShadow(row.id);
      }
      nextOrder.push(row.id);
    }

    notes = nextNotes;
    order = nextOrder;
    saveStates = Object.fromEntries(recovered.map((id) => [id, 'dirty' as NoteSaveState]));
    loading = false;
    loaded = true;
    emit();

    // Push the recovered text back to SQLite immediately — recovery that only
    // lives in memory is one more reload away from being lost twice.
    for (const id of recovered) void runSave(id);
  } catch (e) {
    loading = false;
    loaded = true;
    emit();
    toastCatch('notepad load')(e);
  }
}

/** Re-fetch one note (the sweeper told us its status moved). */
export async function refetchNote(noteId: string): Promise<void> {
  try {
    const rows = await notepadApi.listNotes(true);
    const row = rows.find((r) => r.id === noteId);
    if (row) adopt(row);
    else drop(noteId);
  } catch (e) {
    silentCatch('notepad refetch')(e);
  }
}

// --- actions ------------------------------------------------------------------

export async function createNote(title: string, projectId?: string | null): Promise<DevNote | null> {
  try {
    const row = await notepadApi.createNote(title, projectId ?? null);
    adopt(row);
    return row;
  } catch (e) {
    toastCatch('notepad create')(e);
    return null;
  }
}

/** Rename goes through the same debounced door as body edits — a title is a
 *  field of the same document, and a second save path is a second bug. */
export function renameNote(id: string, title: string): void {
  patchNote(id, { title });
}

export function setProject(id: string, projectId: string | null): void {
  patchNote(id, { projectId });
}

async function transition(id: string, status: NoteStatus, label: string): Promise<DevNote | null> {
  await flush(id);
  try {
    const row = await notepadApi.setNoteStatus(id, status);
    adopt(row);
    return row;
  } catch (e) {
    toastCatch(`notepad ${label}`)(e);
    return null;
  }
}

export function archiveNote(id: string): Promise<DevNote | null> {
  return transition(id, 'archived', 'archive');
}

/** Archived → draft. Refused server-side when the cap is already full. */
export function restoreNote(id: string): Promise<DevNote | null> {
  return transition(id, 'draft', 'restore');
}

/** Draft or archived only — the server refuses the rest. */
export async function deleteNote(id: string): Promise<boolean> {
  await flush(id);
  try {
    await notepadApi.deleteNote(id);
    clearShadow(id);
    drop(id);
    return true;
  } catch (e) {
    toastCatch('notepad delete')(e);
    return false;
  }
}

export async function forkNote(id: string): Promise<DevNote | null> {
  await flush(id);
  try {
    const row = await notepadApi.forkNote(id);
    adopt(row);
    return row;
  } catch (e) {
    toastCatch('notepad fork')(e);
    return null;
  }
}

// --- live wiring --------------------------------------------------------------

// Module-level latch so the sweeper listener and the unload flush attach
// exactly once per app process regardless of how many surfaces mount. Kept on
// globalThis so an HMR reload of this module doesn't double-register — same
// reasoning (and the same shape) as `__personasFleetSessionListeners`.
const LISTENER_KEY = '__personasNotepadListeners';
interface ListenerFlag {
  started: boolean;
  unlisten: UnlistenFn[];
}
const listenerFlag = (): ListenerFlag => {
  const g = globalThis as unknown as Record<string, ListenerFlag | undefined>;
  return (g[LISTENER_KEY] ??= { started: false, unlisten: [] });
};

/** Attach the sweeper listener + the unload flush. Idempotent. */
export function startNotepadListeners(): void {
  const flag = listenerFlag();
  if (flag.started) return;
  flag.started = true;

  void typedListen(EventName.NOTEPAD_NOTE_CHANGED, (payload) => {
    void refetchNote(payload.noteId);
  }).then((un) => flag.unlisten.push(un));

  // Last line of defence for the debounce window. `pagehide` fires on the
  // WebView teardown path where `beforeunload` sometimes does not; both are
  // registered because neither is reliable alone.
  const onUnload = () => {
    void flush();
  };
  window.addEventListener('beforeunload', onUnload);
  window.addEventListener('pagehide', onUnload);
}

// --- test hatch ---------------------------------------------------------------

/** Test-only reset of the module singletons + pending timers. Mirrors
 *  `__resetLayoutStoreForTests` in the mastermind layout store. */
export function __resetNotepadStoreForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  inFlight.clear();
  notes = {};
  order = [];
  saveStates = {};
  loading = false;
  loaded = false;
  const flag = listenerFlag();
  flag.started = false;
  flag.unlisten = [];
  emit();
}
