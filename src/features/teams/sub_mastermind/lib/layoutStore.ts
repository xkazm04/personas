// Durable Mastermind canvas layout — the single source of truth for the five
// canvas-layout artifact kinds (island positions, group rectangles, project
// links, free-text notes, hidden-project set). Formerly five machine-local
// localStorage keys; now ONE versioned JSON document in the app settings store
// (`mastermind.layout.v1`), so the map survives a browser-data clear and can
// later back shared boards.
//
// Lifecycle:
//   1. `hydrateLayout()` runs ONCE at page mount (async IPC read). The page
//      awaits it, then re-seeds its React state from the sync getters below.
//   2. The existing module APIs (positions/groups/links/notes + hidden) read
//      SYNCHRONOUSLY from the hydrated in-memory doc, so no caller signature
//      changed — CanvasShell et al. stay sync.
//   3. Writes mutate the in-memory doc synchronously, then schedule a debounced
//      (~500ms, coalescing) write-through to the DB — one island drop commits
//      one write, a burst of commits coalesces into one IPC call.
//   4. One-time migration: if the DB doc is absent but the legacy localStorage
//      keys exist, they are imported and written through once; thereafter the DB
//      is the source of truth and the legacy keys are left as a stale backup.
//   5. Graceful fallback: if IPC is unavailable (browser-only dev), reads and
//      writes fall back to a single localStorage key — the canvas never crashes.
import { getAppSetting, setAppSetting } from '@/api/system/settings';
import { silentCatch } from '@/lib/silentCatch';

import type { CanvasNote, GroupRect, UserLink } from './types';

/** DB settings key — registered in the Rust allow-list (`settings_keys.rs`). */
export const LAYOUT_KEY = 'mastermind.layout.v1';

/** Legacy per-artifact localStorage keys (pre-DB). Read once for migration and
 *  used as the browser-only-dev fallback store. */
const LEGACY_KEYS = {
  positions: 'mastermind.positions.v1',
  groups: 'mastermind.groups.v1',
  links: 'mastermind.links.v1',
  notes: 'mastermind.notes.v1',
  hidden: 'mastermind.hidden.v1',
} as const;

/** Debounce window for write-through — long enough to coalesce a burst of
 *  drag-commit saves, short enough to feel durable. */
export const WRITE_DEBOUNCE_MS = 500;

export type PositionMap = Record<string, { x: number; y: number }>;

/** The one versioned document covering all five canvas-layout artifact kinds. */
export interface MastermindLayout {
  version: 1;
  positions: PositionMap;
  groups: GroupRect[];
  links: UserLink[];
  notes: CanvasNote[];
  hidden: string[];
}

const emptyLayout = (): MastermindLayout => ({
  version: 1,
  positions: {},
  groups: [],
  links: [],
  notes: [],
  hidden: [],
});

// --- module singletons (survive component remounts within a session) ---------
let doc: MastermindLayout = emptyLayout();
let hydrated = false;
let hydrating: Promise<void> | null = null;
/** False once an IPC call has failed — routes reads/writes to localStorage. */
let ipcAvailable = true;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// --- parsing / storage helpers ------------------------------------------------

function safeLocalGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    silentCatch('mastermind layout localStorage read')(e);
    return null;
  }
}

function safeLocalSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // best-effort — a full/blocked storage never breaks the canvas
    silentCatch('mastermind layout localStorage write')(e);
  }
}

function jsonOr<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Parse a serialized layout doc, coercing each field to its expected shape and
 *  falling back to empty on malformed / non-object input (never throws). */
function parseLayout(raw: string | null): MastermindLayout | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const p = obj as Partial<MastermindLayout>;
  return {
    version: 1,
    positions: p.positions && typeof p.positions === 'object' ? (p.positions as PositionMap) : {},
    groups: Array.isArray(p.groups) ? p.groups : [],
    links: Array.isArray(p.links) ? p.links : [],
    notes: Array.isArray(p.notes) ? p.notes : [],
    hidden: Array.isArray(p.hidden) ? p.hidden : [],
  };
}

/** Assemble a layout doc from the legacy per-artifact localStorage keys, or
 *  null when none of them are present (nothing to migrate). */
function readLegacyLocal(): MastermindLayout | null {
  const rawPos = safeLocalGet(LEGACY_KEYS.positions);
  const rawGroups = safeLocalGet(LEGACY_KEYS.groups);
  const rawLinks = safeLocalGet(LEGACY_KEYS.links);
  const rawNotes = safeLocalGet(LEGACY_KEYS.notes);
  const rawHidden = safeLocalGet(LEGACY_KEYS.hidden);
  if (!rawPos && !rawGroups && !rawLinks && !rawNotes && !rawHidden) return null;
  return {
    version: 1,
    positions: jsonOr<PositionMap>(rawPos, {}),
    groups: jsonOr<GroupRect[]>(rawGroups, []),
    links: jsonOr<UserLink[]>(rawLinks, []),
    notes: jsonOr<CanvasNote[]>(rawNotes, []),
    hidden: jsonOr<string[]>(rawHidden, []),
  };
}

// --- write-through ------------------------------------------------------------

/** Persist the in-memory doc now. Prefers the DB; on IPC failure (or when IPC
 *  is already known-unavailable) falls back to the single localStorage key. */
async function writeThroughNow(): Promise<void> {
  const json = JSON.stringify(doc);
  if (ipcAvailable) {
    try {
      await setAppSetting(LAYOUT_KEY, json);
      return;
    } catch (e) {
      ipcAvailable = false;
      silentCatch('mastermind layout write-through')(e);
    }
  }
  safeLocalSet(LAYOUT_KEY, json);
}

/** Coalesce write-through: a burst of saves within the debounce window results
 *  in a single persist. */
function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void writeThroughNow();
  }, WRITE_DEBOUNCE_MS);
}

// --- hydration ----------------------------------------------------------------

/** Read the layout doc into memory ONCE. Idempotent and concurrency-safe: a
 *  second call while the first is in flight returns the same promise; after
 *  completion it resolves immediately. Never rejects — IPC failure degrades to
 *  the localStorage path. */
export function hydrateLayout(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydrating) return hydrating;
  hydrating = (async () => {
    let dbRaw: string | null = null;
    let dbReadOk = true;
    try {
      dbRaw = await getAppSetting(LAYOUT_KEY);
      ipcAvailable = true;
    } catch (e) {
      dbReadOk = false;
      ipcAvailable = false;
      silentCatch('mastermind layout hydrate')(e);
    }

    if (dbReadOk) {
      const parsed = parseLayout(dbRaw);
      if (parsed) {
        doc = parsed;
      } else {
        // DB has no doc yet → one-time migration from the legacy localStorage
        // keys. Persist the imported doc immediately so the DB becomes the
        // source of truth; legacy keys are left as a stale backup.
        const legacy = readLegacyLocal();
        if (legacy) {
          doc = legacy;
          await writeThroughNow();
        } else {
          doc = emptyLayout();
        }
      }
    } else {
      // IPC unavailable (browser-only dev): read the single-key doc, or migrate
      // the legacy per-artifact keys, all from localStorage.
      doc = parseLayout(safeLocalGet(LAYOUT_KEY)) ?? readLegacyLocal() ?? emptyLayout();
    }

    hydrated = true;
    hydrating = null;
  })();
  return hydrating;
}

/** True once `hydrateLayout()` has completed — lets the page skip the async
 *  gate on remounts within the same session. */
export function isLayoutHydrated(): boolean {
  return hydrated;
}

// --- sync getters / setters (the stable module API) ---------------------------
// Getters return fresh copies so callers can't mutate the in-memory doc by
// reference; setters replace the field and schedule a debounced write-through.

export function loadPositions(): PositionMap {
  return { ...doc.positions };
}
export function savePositions(p: PositionMap): void {
  doc.positions = { ...p };
  scheduleFlush();
}

export function loadGroups(): GroupRect[] {
  return [...doc.groups];
}
export function saveGroups(g: GroupRect[]): void {
  doc.groups = [...g];
  scheduleFlush();
}

export function loadLinks(): UserLink[] {
  return [...doc.links];
}
export function saveLinks(l: UserLink[]): void {
  doc.links = [...l];
  scheduleFlush();
}

export function loadNotes(): CanvasNote[] {
  return [...doc.notes];
}
export function saveNotes(n: CanvasNote[]): void {
  doc.notes = [...n];
  scheduleFlush();
}

export function loadHidden(): Set<string> {
  return new Set(doc.hidden);
}
export function saveHidden(s: Set<string>): void {
  doc.hidden = [...s];
  scheduleFlush();
}

/** Test-only reset of the module singletons + pending flush. Mirrors the
 *  `_clearAutoDedupForTests` convention in `@/lib/tauriInvoke`. */
export function __resetLayoutStoreForTests(): void {
  doc = emptyLayout();
  hydrated = false;
  hydrating = null;
  ipcAvailable = true;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}
