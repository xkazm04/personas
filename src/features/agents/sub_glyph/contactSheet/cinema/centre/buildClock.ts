/** buildClock — the build clock's ledger, kept OUTSIDE React.
 *
 *  One entry per build session: the machine time already banked, the stretch
 *  open right now (build or test) and since when, and the marks the film rail
 *  tints by. A single store subscription (installed once, never torn down)
 *  opens a stretch when the session's phase says the machine is working and
 *  banks it the moment the phase waits on the user, so the clock is correct
 *  whether or not the sheet is mounted: leaving the build, re-opening the
 *  draft or switching sessions never resets it and never counts waiting time.
 *
 *  Working: initializing, analyzing, resolving (build) and testing (test),
 *  with no question pending. Everything else waits: awaiting_input, a pending
 *  question, draft_ready, completed, test_complete, promoted, failed,
 *  cancelled.
 *
 *  Honesty limits, stated rather than hidden:
 *  - A session first seen mid-build is back-dated to the store's `createdAt`
 *    (the launch, when this app run created it) if that is under 30 min old.
 *    `hydrateBuildSession` re-stamps `createdAt` with Date.now(), so a
 *    hydrated session starts from when it was seen.
 *  - The ledger is mirrored to localStorage so an app restart keeps it; a
 *    stretch open at shutdown is banked only up to its last heartbeat.
 *  - A session first seen while it waits (a draft built before this ledger
 *    existed, or evicted from it) has no history: it is marked `partial` and
 *    the UI says so instead of pretending it took zero seconds. Exact would
 *    need per-phase timestamps persisted on build_sessions. */
import { useAgentStore } from "@/stores/agentStore";
import type { BuildPhase } from "@/lib/types/buildTypes";
import { createModuleCache } from "@/hooks/utility/data/useModuleSubscription";
import { jsonOr, safeLocalGet, safeLocalSet } from "@/lib/safeLocalStorage";

export type ClockKind = "build" | "test";
export interface ClockMark { at: number; kind: ClockKind }
export interface ClockEntry {
  /** Seconds of machine time in closed stretches. */
  banked: number;
  open: ClockKind | null;
  /** Epoch ms the open stretch started. */
  since: number | null;
  /** Epoch ms this entry was last known to be current (heartbeat). */
  seenAt: number;
  marks: ClockMark[];
  /** First seen while waiting: time before that is unknown. */
  partial: boolean;
}

const STORAGE_KEY = "personas.sheetClock.v1";
const MAX_SESSIONS = 24;
const LATE_TRUST_MS = 30 * 60 * 1000;
const PERSIST_EVERY_MS = 5000;

export const CLOCK = createModuleCache<string, ClockEntry>({ maxSize: MAX_SESSIONS });
/** Write order of the ledger's keys (the cache itself is not iterable). */
const ids: string[] = [];
function put(id: string, e: ClockEntry) {
  CLOCK.set(id, e);
  const at = ids.indexOf(id);
  if (at >= 0) ids.splice(at, 1);
  ids.push(id);
  if (ids.length > MAX_SESSIONS) ids.splice(0, ids.length - MAX_SESSIONS);
}

const WORKING: Partial<Record<BuildPhase, ClockKind>> = {
  initializing: "build", analyzing: "build", resolving: "build", testing: "test",
};

export function kindOfPhase(phase: BuildPhase, pendingCount: number): ClockKind | null {
  return pendingCount > 0 ? null : WORKING[phase] ?? null;
}

export function entryElapsed(e: ClockEntry | undefined, now: number): number {
  if (!e) return 0;
  return e.banked + (e.open && e.since !== null ? Math.max(0, now - e.since) / 1000 : 0);
}

let lastPersist = 0;
function persist(now: number) {
  lastPersist = now;
  const rows: [string, ClockEntry][] = [];
  for (const id of ids) {
    const e = CLOCK.get(id);
    if (e) rows.push([id, e.open ? { ...e, seenAt: now } : e]);
  }
  safeLocalSet(STORAGE_KEY, JSON.stringify(rows), "sheetClock.persist");
}

/** Restore after a restart: a stretch left open is banked to its heartbeat. */
function restore() {
  const rows = jsonOr<unknown>(safeLocalGet(STORAGE_KEY, "sheetClock.restore"), []);
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!Array.isArray(row) || typeof row[0] !== "string" || !row[1] || typeof row[1] !== "object") continue;
    // Shape written by persist() above; each field is re-checked before use.
    const e = row[1] as Partial<ClockEntry>;
    if (typeof e.banked !== "number") continue;
    const seenAt = typeof e.seenAt === "number" ? e.seenAt : 0;
    const openFor = e.open && typeof e.since === "number" ? Math.max(0, seenAt - e.since) / 1000 : 0;
    put(row[0], {
      banked: e.banked + openFor, open: null, since: null, seenAt,
      marks: Array.isArray(e.marks) ? e.marks : [], partial: !!e.partial,
    });
  }
}

function reconcile() {
  const now = Date.now();
  const sessions = useAgentStore.getState().buildSessions;
  let changed = false;
  for (const [id, s] of Object.entries(sessions)) {
    const kind = kindOfPhase(s.phase, s.pendingQuestions?.length ?? 0);
    const prev = CLOCK.get(id);
    if (!prev) {
      const age = now - s.createdAt;
      const since = kind ? (age > 0 && age < LATE_TRUST_MS ? s.createdAt : now) : null;
      put(id, {
        banked: 0, open: kind, since, seenAt: now,
        marks: kind ? [{ at: 0, kind }] : [], partial: kind === null,
      });
      changed = true;
      continue;
    }
    if (prev.open === kind) continue;
    const banked = entryElapsed(prev, now);
    const last = prev.marks[prev.marks.length - 1];
    put(id, {
      ...prev, banked, open: kind, since: kind ? now : null, seenAt: now,
      marks: kind && last?.kind !== kind ? [...prev.marks, { at: banked, kind }] : prev.marks,
    });
    changed = true;
  }
  if (changed) {
    CLOCK.notify();
    persist(now);
  } else if (now - lastPersist > PERSIST_EVERY_MS) {
    persist(now);
  }
}

type ClockGlobal = typeof globalThis & {
  __personasSheetClockStop?: () => void;
  __personasSheetClockOwner?: object;
};

/** This module evaluation's identity. The globalThis slot below records which
 *  evaluation owns the live subscription, so the guard survives an HMR swap
 *  without a module-scope latch: a fresh evaluation has a fresh token, stops
 *  the previous owner's subscription and installs its own. */
const OWNER = {};

/** Idempotent. Refcount-free on purpose: the ledger must keep recording
 *  while no sheet is mounted, which is the whole point. Re-running after an
 *  HMR module swap replaces the previous subscription instead of doubling it. */
export function ensureClockTracking() {
  const g = globalThis as ClockGlobal;
  if (g.__personasSheetClockOwner === OWNER) return;
  g.__personasSheetClockStop?.();
  g.__personasSheetClockOwner = OWNER;
  restore();
  const unsub = useAgentStore.subscribe(reconcile);
  const onHide = () => persist(Date.now());
  window.addEventListener("pagehide", onHide);
  g.__personasSheetClockStop = () => { unsub(); window.removeEventListener("pagehide", onHide); };
  reconcile();
}
