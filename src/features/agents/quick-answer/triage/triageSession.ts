/**
 * triageSession — the reviewer's working state, across a closed deck.
 *
 * Everything the deck knew lived in `useState` inside two hooks, and
 * `QuickAnswerPopover` unmounts the moment the header overlay changes. Close the
 * deck to go and read the run behind a review, come back, and: every card you
 * deferred is back at full weight, the skip-pass bound has reset (so the wedge
 * guard that makes the deck finishable reset with it), your half-typed answer is
 * gone, and the progress readout is at zero. The deck punished you for looking
 * at anything else in the app.
 *
 * ## Why localStorage, and not the two heavier options
 *
 * The state here is **per-reviewer working state, not shared truth**. A skip
 * means "not me, not now"; a kind filter means "I'm doing practices today"; a
 * draft is half a sentence. None of it is a fact about the row — the authoritative
 * record of what was DECIDED already lives in SQLite, written by the verdict
 * doors, and nothing here can contradict it.
 *
 *  • **SQLite** would mean a migration, a table, a Tauri command, ts-rs
 *    bindings and an IPC round-trip per keystroke in an answer box, to durably
 *    replicate state whose worst-case loss is "you are shown a card you had
 *    deferred". That is a schema the product would then have to keep forever.
 *  • **A Zustand persisted slice** would move deck-local state into the app's
 *    global store graph, where every surface that touches that store re-renders
 *    on a keystroke in the deck, and where "what is the deck's current skip
 *    ledger" becomes app-wide API. The deck already owns this state correctly in
 *    hooks; only its LIFETIME was wrong.
 *  • **localStorage** is synchronous, so a remount rehydrates before first
 *    paint — no flash of the queue you already cleared — costs no schema, and
 *    keeps the blast radius at exactly one module.
 *
 * If a future round wants this cross-device or queryable, THIS is the file to
 * repoint; nothing else knows where the bytes live.
 *
 * ## Two bounds, both deliberate
 *
 *  • **A TTL.** "Not now" has a now. Resurrecting last Tuesday's deferrals would
 *    make the deck permanently smaller than the queue, which is the exact
 *    failure the bounded skip-pass rule exists to prevent.
 *  • **Caps per collection.** A ledger that only ever grows is a ledger that
 *    eventually blows the 5MB origin quota and takes the WHOLE record with it,
 *    including the drafts. Oldest entries are dropped first.
 *
 * React-free and store-free on purpose.
 */
import { silentCatch } from '@/lib/silentCatch';

import { TRIAGE_KINDS, type TriageKind } from './triageTypes';

const STORAGE_KEY = 'personas.triage.session.v1';

/**
 * How long a paused session is still the same session.
 *
 * Twelve hours covers "I closed the deck to look at the run and came back after
 * lunch" and does not cover "I opened this yesterday". A reviewer who wants the
 * clean slate sooner has `reload()` on the cleared state, which clears this.
 */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const MAX_SKIPS = 400;
const MAX_RESOLVED = 600;
const MAX_DRAFTS = 100;
/** A draft is an answer to a build question, not an essay. */
const MAX_DRAFT_CHARS = 4000;

/** What the deck rehydrates from. */
export interface TriageSession {
  /** Epoch ms this session began — the window the journal summary reports over. */
  startedAt: number;
  /** Times each item has been skipped. */
  skips: Map<string, number>;
  /** The kind filter, or null when the reviewer never changed it. */
  kinds: Set<TriageKind> | null;
  /** Answer drafts, keyed `${sourceId}::${fieldKey}`. */
  drafts: Record<string, string>;
  /** Ids this session already wrote a verdict for. */
  resolved: Set<string>;
}

interface StoredSession {
  v: 1;
  startedAt: number;
  /** Last write. The record expires {@link SESSION_TTL_MS} after it. */
  at: number;
  skips: [string, number][];
  kinds: TriageKind[] | null;
  drafts: [string, string][];
  resolved: string[];
}

/** A session that has never been written — what a first open sees. */
function emptySession(): TriageSession {
  return {
    startedAt: Date.now(),
    skips: new Map(),
    kinds: null,
    drafts: {},
    resolved: new Set(),
  };
}

function storage(): Storage | null {
  try {
    // Absent under SSR and in some hardened embeddings; ACCESS can throw when
    // the origin has storage disabled, so the try wraps the read too.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const KNOWN_KINDS = new Set<string>(TRIAGE_KINDS);

/** Last thing read or written, so a keystroke does not re-parse the record. */
let cached: StoredSession | null = null;

function readStored(): StoredSession | null {
  if (cached) return cached;
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    // Anything not shaped like the current version is discarded rather than
    // migrated: this is working state, and a wrong rehydration is worse than
    // none.
    if (parsed.v !== 1 || typeof parsed.at !== 'number') return null;
    if (Date.now() - parsed.at > SESSION_TTL_MS) return null;
    cached = {
      v: 1,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : parsed.at,
      at: parsed.at,
      skips: Array.isArray(parsed.skips) ? parsed.skips : [],
      kinds: Array.isArray(parsed.kinds) ? parsed.kinds.filter((k) => KNOWN_KINDS.has(k)) : null,
      drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
      resolved: Array.isArray(parsed.resolved) ? parsed.resolved : [],
    };
    return cached;
  } catch {
    // Corrupt or unreadable: behave exactly as a first open. Never throw out of
    // a rehydrate — the deck must open even when its memory does not.
    return null;
  }
}

/**
 * The session as it stands. Always returns a usable value: an unreadable,
 * corrupt, expired or absent record is a fresh session, not an error.
 */
export function loadTriageSession(): TriageSession {
  const stored = readStored();
  if (!stored) return emptySession();
  return {
    startedAt: stored.startedAt,
    skips: new Map(stored.skips),
    kinds: stored.kinds && stored.kinds.length > 0 ? new Set(stored.kinds) : null,
    drafts: Object.fromEntries(stored.drafts),
    resolved: new Set(stored.resolved),
  };
}

/** Keep the LAST `max` entries — the oldest deferral is the least useful one. */
function tail<T>(items: T[], max: number): T[] {
  return items.length > max ? items.slice(items.length - max) : items;
}

/**
 * Persist part of the session, merging into whatever is already stored.
 *
 * Partial by design: the skip ledger and the kind filter live in
 * `useUnifiedTriage` while the drafts live in `useDeckControls`, and neither
 * hook should have to know — or be able to clobber — the other's half.
 */
export interface TriageSessionPatch {
  skips?: ReadonlyMap<string, number>;
  kinds?: ReadonlySet<TriageKind>;
  drafts?: Readonly<Record<string, string>>;
  resolved?: ReadonlySet<string>;
  /**
   * When this sitting began — the window the journal summary reports over.
   *
   * Explicit, because the alternative is implicit in WRITE TIMING. `startedAt`
   * used to be stamped `Date.now()` by whichever write happened to land first,
   * which was only ever correct because three effects fired on mount and one of
   * them got there before anything was decided. Coalescing those writes moved
   * the first write to the first DECISION, and the session then began after the
   * entry it was meant to contain — a summary that reported zero for a sitting
   * that had just recorded a verdict. The owner of the session knows when it
   * started; it says so rather than relying on being early.
   */
  startedAt?: number;
}

export function saveTriageSession(patch: TriageSessionPatch): void {
  const store = storage();
  if (!store) return;
  const current = readStored();
  const next: StoredSession = {
    v: 1,
    startedAt: patch.startedAt ?? current?.startedAt ?? Date.now(),
    at: Date.now(),
    skips: patch.skips ? tail([...patch.skips], MAX_SKIPS) : (current?.skips ?? []),
    kinds: patch.kinds ? [...patch.kinds] : (current?.kinds ?? null),
    drafts: patch.drafts
      ? tail(
          Object.entries(patch.drafts)
            .filter(([, value]) => value.length > 0)
            .map(([key, value]): [string, string] => [key, value.slice(0, MAX_DRAFT_CHARS)]),
          MAX_DRAFTS,
        )
      : (current?.drafts ?? []),
    resolved: patch.resolved ? tail([...patch.resolved], MAX_RESOLVED) : (current?.resolved ?? []),
  };
  cached = next;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    // Quota or a hardened origin. The in-memory session keeps working; only its
    // survival across a close is lost, which is the state this file exists to
    // improve, not a state the deck depends on. Breadcrumbed rather than
    // swallowed: "my deferrals stopped sticking" is otherwise undiagnosable.
    silentCatch('triageSession:save')(error);
  }
}

/** Forget the session — what `reload()` means: "show me the world again". */
export function clearTriageSession(): void {
  cached = null;
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch (error) {
    // Same posture as the write: unreachable storage must not break the deck.
    silentCatch('triageSession:clear')(error);
  }
}

/** Test seam. Drops the parse cache so a test can write storage directly. */
export function resetTriageSessionCache(): void {
  cached = null;
}
