// Durable Mastermind layout — Athena's composed panel specs, one per project,
// in ONE versioned JSON document in the app settings store
// (`mastermind.layout.v1`).
//
// The document used to carry the Hex Mosaic's canvas artifacts too (island
// positions, groups, links, notes, the hidden-project set). That canvas was
// retired on 2026-09-25 when Soundings became the only Mastermind view; those
// fields are no longer read, but they are CARRIED THROUGH on every write rather
// than dropped, so retiring the view never erased what a user had drawn.
//
// Lifecycle:
//   1. `hydrateLayout()` runs once (async IPC read); subscribers are notified
//      when it lands.
//   2. Writes mutate the in-memory doc synchronously, notify subscribers, then
//      schedule a debounced (~500ms, coalescing) write-through to the DB.
//   3. Graceful fallback: if IPC is unavailable (browser-only dev), reads and
//      writes fall back to a single localStorage key.
//
// Athena writes panels out of band (useCanvasPanelBridge) while the page may be
// open, so views subscribe (`subscribeLayout` + `useAthenaPanels`) instead of
// snapshotting into `useState`.
import { getAppSetting, setAppSetting } from '@/api/system/settings';
import { safeLocalGet as sharedLocalGet, safeLocalSet as sharedLocalSet } from '@/lib/safeLocalStorage';
import { silentCatch } from '@/lib/silentCatch';

/** DB settings key — registered in the Rust allow-list (`settings_keys.rs`).
 *  The key is stable across doc versions; the `version` FIELD is what moves. */
export const LAYOUT_KEY = 'mastermind.layout.v1';

/** Current document version (v2 added the `athenaPanels` map). */
export const LAYOUT_DOC_VERSION = 2;

/** Panel-spec versions this build understands. An `athenaPanels` entry carrying
 *  anything else is DROPPED on parse (tolerate-and-drop) — never retained as a
 *  poison value a renderer would have to defend against. */
export const SUPPORTED_PANEL_SPEC_VERSIONS: ReadonlySet<number> = new Set([1]);

/** Debounce window for write-through. */
export const WRITE_DEBOUNCE_MS = 500;

/** One Athena-composed project panel. `spec` is OPAQUE here — the composer owns
 *  its shape; the store only guards the envelope. */
export interface AthenaPanel {
  specVersion: number;
  spec: unknown;
  /** ISO timestamp of the composition that produced this spec. */
  composedAt: string;
}

/** The stored document. Every field this build does not read (the retired
 *  canvas artifacts, or a newer build's additions) rides along in `rest`. */
interface MastermindLayout {
  version: number;
  /** Athena's composed panels, keyed by project slug. */
  athenaPanels: Record<string, AthenaPanel>;
  rest: Record<string, unknown>;
}

const emptyLayout = (): MastermindLayout => ({ version: LAYOUT_DOC_VERSION, athenaPanels: {}, rest: {} });

// --- module singletons (survive component remounts within a session) ---------
let doc: MastermindLayout = emptyLayout();
let hydrated = false;
let hydrating: Promise<void> | null = null;
/** False once an IPC call has failed — routes reads/writes to localStorage. */
let ipcAvailable = true;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// --- subscription -------------------------------------------------------------
type Listener = () => void;
const listeners = new Set<Listener>();
/** The snapshot container, stable until a write — what `useSyncExternalStore` needs. */
let panelsSnapshot: Readonly<Record<string, AthenaPanel>> | null = null;

/** Subscribe to any layout change (Athena write, reset, hydration). */
export function subscribeLayout(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  panelsSnapshot = null;
  for (const l of [...listeners]) l();
}

// --- persistence ----------------------------------------------------------------

const safeLocalGet = (key: string) => sharedLocalGet(key, 'mastermind layout storage read');
const safeLocalSet = (key: string, value: string) =>
  sharedLocalSet(key, value, 'mastermind layout storage write');

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

/** Parse a serialized layout doc, falling back to null on malformed or
 *  non-object input (never throws). A version this build does not know is
 *  PRESERVED rather than coerced down — see `isLayoutFromNewerBuild`. */
function parseLayout(raw: string | null): MastermindLayout | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const { version, athenaPanels, ...rest } = obj as Record<string, unknown>;
  return {
    version: typeof version === 'number' && version > LAYOUT_DOC_VERSION ? version : LAYOUT_DOC_VERSION,
    athenaPanels: parsePanels(athenaPanels),
    rest,
  };
}

const serialize = (d: MastermindLayout): string =>
  JSON.stringify({ ...d.rest, version: d.version, athenaPanels: d.athenaPanels });

/** Persist the in-memory doc now. Prefers the DB; on IPC failure (or when IPC
 *  is already known-unavailable) falls back to the single localStorage key. */
async function writeThroughNow(): Promise<void> {
  if (isLayoutFromNewerBuild()) return;
  const json = serialize(doc);
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

/** Coalesce write-through: a burst of saves within the window persists once. */
function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void writeThroughNow();
  }, WRITE_DEBOUNCE_MS);
}

/** Read the layout doc into memory ONCE. Idempotent and concurrency-safe: a
 *  second call while the first is in flight returns the same promise. Never
 *  rejects — IPC failure degrades to the localStorage path. */
export function hydrateLayout(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydrating) return hydrating;
  hydrating = (async () => {
    let raw: string | null;
    try {
      raw = await getAppSetting(LAYOUT_KEY);
      ipcAvailable = true;
    } catch (e) {
      ipcAvailable = false;
      silentCatch('mastermind layout hydrate')(e);
      raw = safeLocalGet(LAYOUT_KEY);
    }
    doc = parseLayout(raw) ?? emptyLayout();
    hydrated = true;
    hydrating = null;
    emit();
  })();
  return hydrating;
}

/** True when the stored doc was written by a build newer than this one: edits
 *  then live for the session and are not persisted over it. */
export function isLayoutFromNewerBuild(): boolean {
  return doc.version > LAYOUT_DOC_VERSION;
}

// --- panels -----------------------------------------------------------------------

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

/** Same data as `loadAthenaPanels`, but the SAME container until a write
 *  invalidates it. Treat the result as immutable. */
export const athenaPanelsSnapshot = (): Readonly<Record<string, AthenaPanel>> =>
  (panelsSnapshot ??= { ...doc.athenaPanels });

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
