// Durable Mastermind canvas layout — the single source of truth for the canvas
// layout artifacts (island positions, group rectangles, project links,
// free-text notes, hidden-project set) plus Athena's composed panel specs.
// Formerly five machine-local localStorage keys; now ONE versioned JSON
// document in the app settings store (`mastermind.layout.v1`), so the map
// survives a browser-data clear and can later back shared boards.
//
// Lifecycle:
//   1. `hydrateLayout()` runs ONCE at page mount (async IPC read). The page
//      awaits it; subscribers are notified when it lands.
//   2. The existing module APIs (positions/groups/links/notes + hidden) read
//      SYNCHRONOUSLY from the hydrated in-memory doc, so no caller signature
//      changed — CanvasShell et al. stay sync.
//   3. Writes mutate the in-memory doc synchronously, notify subscribers, then
//      schedule a debounced (~500ms, coalescing) write-through to the DB — one
//      island drop commits one write, a burst of commits coalesces into one IPC
//      call.
//   4. One-time migration: if the DB doc is absent but the legacy localStorage
//      keys exist, they are imported and written through once; thereafter the DB
//      is the source of truth and the legacy keys are left as a stale backup.
//   5. Graceful fallback: if IPC is unavailable (browser-only dev), reads and
//      writes fall back to a single localStorage key — the canvas never crashes.
//
// TWO WRITERS. Athena composes canvas objects programmatically while the user
// is editing the same board. Two things make that safe:
//   * The store is the ONE mutable copy. Views subscribe (`subscribeLayout` +
//     the `useLayout*` hooks) instead of snapshotting into `useState`, so an
//     out-of-band write renders immediately and the next user commit is built
//     from the post-write array rather than a stale one.
//   * Every group / link / note carries an `author` (`'user' | 'athena'`), so
//     hers can be told apart on the canvas and reverted without touching his.
import { getAppSetting, setAppSetting } from '@/api/system/settings';
import { silentCatch } from '@/lib/silentCatch';

import type { CanvasNote, GroupRect, LayoutAuthor, UserLink } from './types';

/** DB settings key — registered in the Rust allow-list (`settings_keys.rs`).
 *  The key is stable across doc versions; the `version` FIELD is what moves. */
export const LAYOUT_KEY = 'mastermind.layout.v1';

/** Current document version. v1 → v2 added `author` on every canvas object and
 *  the `athenaPanels` map. */
export const LAYOUT_DOC_VERSION = 2;

/** Panel-spec versions this build understands. An `athenaPanels` entry carrying
 *  anything else is DROPPED on parse (tolerate-and-drop) — never retained as a
 *  poison value a renderer would have to defend against. */
export const SUPPORTED_PANEL_SPEC_VERSIONS: ReadonlySet<number> = new Set([1]);

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

/** One Athena-composed island panel. `spec` is OPAQUE here — the composer owns
 *  its shape; the store only guards the envelope. */
export interface AthenaPanel {
  specVersion: number;
  spec: unknown;
  /** ISO timestamp of the composition that produced this spec. */
  composedAt: string;
}

/** The one versioned document covering every canvas-layout artifact. */
export interface MastermindLayout {
  version: number;
  positions: PositionMap;
  groups: GroupRect[];
  links: UserLink[];
  notes: CanvasNote[];
  hidden: string[];
  /** Athena's composed panels, keyed by project slug. */
  athenaPanels: Record<string, AthenaPanel>;
}

const emptyLayout = (): MastermindLayout => ({
  version: LAYOUT_DOC_VERSION,
  positions: {},
  groups: [],
  links: [],
  notes: [],
  hidden: [],
  athenaPanels: {},
});

// --- module singletons (survive component remounts within a session) ---------
let doc: MastermindLayout = emptyLayout();
let hydrated = false;
let hydrating: Promise<void> | null = null;
/** False once an IPC call has failed — routes reads/writes to localStorage. */
let ipcAvailable = true;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// --- subscription (the second-writer contract) -------------------------------
// Views read through the *snapshot* getters below, which hand back the SAME
// container until something writes. That stability is what `useSyncExternalStore`
// needs, and the invalidate-on-write is what makes an out-of-band write paint.
type Listener = () => void;
const listeners = new Set<Listener>();

interface SnapshotCache {
  positions?: PositionMap;
  groups?: readonly GroupRect[];
  links?: readonly UserLink[];
  notes?: readonly CanvasNote[];
  hidden?: ReadonlySet<string>;
  panels?: Readonly<Record<string, AthenaPanel>>;
}
let cache: SnapshotCache = {};

/** Subscribe to any layout change (user commit, Athena write, hydration).
 *  Returns the unsubscribe function — the `useSyncExternalStore` contract. */
export function subscribeLayout(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Invalidate the snapshot containers and notify every subscriber. */
function emit(): void {
  cache = {};
  for (const l of [...listeners]) l();
}

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

/** v1 → v2 attribution. Anything that is not literally `'athena'` — absent,
 *  misspelled, a number, an object — is the user's. Attribution can only ever
 *  ADD provenance, never take an object away from its owner. */
function coerceAuthor(value: unknown): LayoutAuthor {
  return value === 'athena' ? 'athena' : 'user';
}

/** Stamp `author` onto every element of a stored array, dropping non-objects.
 *  This IS the v1 → v2 migration for canvas objects: a v1 doc has no `author`
 *  anywhere, so every pre-existing object comes back attributed to the user. */
function migrateAuthored<T extends { author?: LayoutAuthor }>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    out.push({ ...(item as T), author: coerceAuthor((item as { author?: unknown }).author) });
  }
  return out;
}

/** Keep only well-formed panels on a spec version this build understands. */
function parsePanels(value: unknown): Record<string, AthenaPanel> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, AthenaPanel> = {};
  for (const [slug, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const p = raw as Partial<AthenaPanel>;
    if (typeof p.specVersion !== 'number' || !SUPPORTED_PANEL_SPEC_VERSIONS.has(p.specVersion)) continue;
    if (!('spec' in p)) continue;
    out[slug] = {
      specVersion: p.specVersion,
      spec: p.spec,
      composedAt: typeof p.composedAt === 'string' ? p.composedAt : '',
    };
  }
  return out;
}

/** Parse a serialized layout doc, coercing each field to its expected shape and
 *  falling back to empty on malformed / non-object input (never throws). Any
 *  version parses: v1 docs gain `author: 'user'` + an empty panel map here.
 *  A version this build does not know is PRESERVED rather than coerced down —
 *  see `isLayoutFromNewerBuild`. */
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
    // Skew runs in both directions. Stamping the current version onto whatever
    // was parsed turns a rollback into data loss: a v3 doc would be re-saved as
    // v2 with every field this build has no parser for silently dropped.
    version: typeof p.version === 'number' && p.version > LAYOUT_DOC_VERSION ? p.version : LAYOUT_DOC_VERSION,
    positions: p.positions && typeof p.positions === 'object' ? (p.positions as PositionMap) : {},
    groups: migrateAuthored<GroupRect>(p.groups),
    links: migrateAuthored<UserLink>(p.links),
    notes: migrateAuthored<CanvasNote>(p.notes),
    hidden: Array.isArray(p.hidden) ? p.hidden : [],
    athenaPanels: parsePanels(p.athenaPanels),
  };
}

/** Assemble a layout doc from the legacy per-artifact localStorage keys, or
 *  null when none of them are present (nothing to migrate). Legacy data is
 *  pre-v2 by definition, so it lands attributed to the user. */
function readLegacyLocal(): MastermindLayout | null {
  const rawPos = safeLocalGet(LEGACY_KEYS.positions);
  const rawGroups = safeLocalGet(LEGACY_KEYS.groups);
  const rawLinks = safeLocalGet(LEGACY_KEYS.links);
  const rawNotes = safeLocalGet(LEGACY_KEYS.notes);
  const rawHidden = safeLocalGet(LEGACY_KEYS.hidden);
  if (!rawPos && !rawGroups && !rawLinks && !rawNotes && !rawHidden) return null;
  return {
    version: LAYOUT_DOC_VERSION,
    positions: jsonOr<PositionMap>(rawPos, {}),
    groups: migrateAuthored<GroupRect>(jsonOr<unknown>(rawGroups, [])),
    links: migrateAuthored<UserLink>(jsonOr<unknown>(rawLinks, [])),
    notes: migrateAuthored<CanvasNote>(jsonOr<unknown>(rawNotes, [])),
    hidden: jsonOr<string[]>(rawHidden, []),
    athenaPanels: {},
  };
}

// --- write-through ------------------------------------------------------------

/** Persist the in-memory doc now. Prefers the DB; on IPC failure (or when IPC
 *  is already known-unavailable) falls back to the single localStorage key. */
async function writeThroughNow(): Promise<void> {
  // Preserve-and-default: this session renders the fields it understands, but a
  // payload from a newer build is never written back — its author is the only
  // code that can serialize it without loss.
  if (isLayoutFromNewerBuild()) return;
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
    emit();
  })();
  return hydrating;
}

/** True when the stored doc was written by a build newer than this one. The
 *  canvas is then read-only against storage: edits live for the session and are
 *  not persisted, and a surface can disclose that instead of silently losing
 *  them. Distinguishable from a first run, which is what the law asks for. */
export function isLayoutFromNewerBuild(): boolean {
  return doc.version > LAYOUT_DOC_VERSION;
}

/** True once `hydrateLayout()` has completed — lets the page skip the async
 *  gate on remounts within the same session. */
export function isLayoutHydrated(): boolean {
  return hydrated;
}

// --- sync getters / setters (the stable module API) ---------------------------
// Getters return fresh copies so callers can't mutate the in-memory doc by
// reference; setters replace the field, notify subscribers, and schedule a
// debounced write-through.

export function loadPositions(): PositionMap {
  return { ...doc.positions };
}
export function savePositions(p: PositionMap): void {
  doc.positions = { ...p };
  emit();
  scheduleFlush();
}

export function loadGroups(): GroupRect[] {
  return [...doc.groups];
}
/** `persist: false` = a live drag frame: memory + subscribers update so the
 *  canvas follows the pointer, but no DB write is scheduled until release. */
export function saveGroups(g: GroupRect[], persist = true): void {
  doc.groups = [...g];
  emit();
  if (persist) scheduleFlush();
}

export function loadLinks(): UserLink[] {
  return [...doc.links];
}
export function saveLinks(l: UserLink[], persist = true): void {
  doc.links = [...l];
  emit();
  if (persist) scheduleFlush();
}

export function loadNotes(): CanvasNote[] {
  return [...doc.notes];
}
export function saveNotes(n: CanvasNote[], persist = true): void {
  doc.notes = [...n];
  emit();
  if (persist) scheduleFlush();
}

export function loadHidden(): Set<string> {
  return new Set(doc.hidden);
}
export function saveHidden(s: Set<string>): void {
  doc.hidden = [...s];
  emit();
  scheduleFlush();
}

export function loadAthenaPanels(): Record<string, AthenaPanel> {
  return { ...doc.athenaPanels };
}
/** Store one composed panel. A spec version this build does not understand is
 *  refused here too, so an unsupported value can never reach the doc. */
export function saveAthenaPanel(slug: string, panel: AthenaPanel): void {
  if (!SUPPORTED_PANEL_SPEC_VERSIONS.has(panel.specVersion)) return;
  doc.athenaPanels = { ...doc.athenaPanels, [slug]: panel };
  emit();
  scheduleFlush();
}
export function removeAthenaPanel(slug: string): void {
  if (!(slug in doc.athenaPanels)) return;
  const next = { ...doc.athenaPanels };
  delete next[slug];
  doc.athenaPanels = next;
  emit();
  scheduleFlush();
}

// --- snapshot getters (for `useSyncExternalStore`) ----------------------------
// Same data as the load* getters, but the SAME container is returned until a
// write invalidates it. Treat every result as immutable.

export const positionsSnapshot = (): PositionMap => (cache.positions ??= { ...doc.positions });
export const groupsSnapshot = (): readonly GroupRect[] => (cache.groups ??= [...doc.groups]);
export const linksSnapshot = (): readonly UserLink[] => (cache.links ??= [...doc.links]);
export const notesSnapshot = (): readonly CanvasNote[] => (cache.notes ??= [...doc.notes]);
export const hiddenSnapshot = (): ReadonlySet<string> => (cache.hidden ??= new Set(doc.hidden));
export const athenaPanelsSnapshot = (): Readonly<Record<string, AthenaPanel>> =>
  (cache.panels ??= { ...doc.athenaPanels });

// --- provenance ---------------------------------------------------------------

/** How many ANNOTATIONS (groups / links / notes) Athena authored — drives the
 *  revert affordance's visibility and its confirmation copy.
 *
 *  Panels are deliberately NOT counted. A composed panel is not a mark on the
 *  board, it is a per-project surface with its own reset; folding it into a
 *  canvas-scoped "remove her scribbles" control would mean a user tidying two
 *  sticky notes silently loses composed panels for every project. Two scopes,
 *  two controls. */
export function countAthenaObjects(): number {
  const authored = (arr: ReadonlyArray<{ author?: LayoutAuthor }>) =>
    arr.filter((o) => o.author === 'athena').length;
  return authored(doc.groups) + authored(doc.links) + authored(doc.notes);
}

/** Remove every Athena-authored ANNOTATION, leaving the user's objects — and
 *  `athenaPanels` — untouched. One write, one notify, one debounced flush.
 *  Returns how many were removed. */
export function revertAthenaObjects(): number {
  const removed = countAthenaObjects();
  if (removed === 0) return 0;
  const mine = <T extends { author?: LayoutAuthor }>(arr: T[]) => arr.filter((o) => o.author !== 'athena');
  doc.groups = mine(doc.groups);
  doc.links = mine(doc.links);
  doc.notes = mine(doc.notes);
  emit();
  scheduleFlush();
  return removed;
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
  emit();
}
