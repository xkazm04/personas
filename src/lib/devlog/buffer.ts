// ---------------------------------------------------------------------------
// devlog buffer - the WebView's one door into the app's JSONL log file.
//
// Producers call `devlog(record)`; records sit in a bounded ring and leave in
// batches through the `devlog_ingest` command (wired by `installDevlog` in
// ./index.ts, so this module imports no IPC and `log.ts` can depend on it
// without a cycle through `tauriInvoke.ts`).
//
// Flush triggers: 2 s after the first pending record, at 50 queued records,
// and on `pagehide` / `visibilitychange:hidden`. A failed flush is dropped:
// no toast, no log call (that would feed the buffer it failed to drain), at
// most one console.warn per minute in DEV.
//
// Before `installDevlog` runs (and in unit tests, which never run main.tsx)
// records only accumulate in the ring: no timers, no listeners, no IPC.
//
// PROD filter (probe-cost-budgeting): only `error`, `ipc_slow` >= 1000 ms and
// `freeze` are sent. Producers of the DEV-only kinds are gated on
// `import.meta.env.DEV` at their call sites so they are not even constructed;
// the check in `devlog()` is the backstop.
// ---------------------------------------------------------------------------

import type { DevlogRecord } from '@/lib/bindings/DevlogRecord';
import type { CommandName } from '@/lib/commandNames.generated';

/** The ingest command. `tauriInvoke.ts` excludes it from its own metrics. */
export const DEVLOG_INGEST_COMMAND = 'devlog_ingest' satisfies CommandName;

export const DEVLOG_RING_SIZE = 500;
export const DEVLOG_FLUSH_INTERVAL_MS = 2_000;
export const DEVLOG_FLUSH_AT = 50;
export const DEVLOG_FLUSH_TIMEOUT_MS = 5_000;
export const PROD_IPC_SLOW_MS = 1_000;
const FAILURE_WARN_INTERVAL_MS = 60_000;

/** What a producer hands in; the buffer stamps `cts` and `route`. */
export type DevlogInput = Omit<DevlogRecord, 'cts' | 'route'>;

type Send = (records: DevlogRecord[]) => Promise<unknown>;
type Contributor = () => DevlogInput[];

const ring: DevlogRecord[] = [];
let dropped = 0;
let send: Send | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let readRoute: (() => string | null | undefined) | null = null;
let lastFailureWarnAt = 0;
const contributors = new Set<Contributor>();

/** True when this build is a production bundle. Read per call so tests can stub it. */
export function isProdBuild(): boolean {
  return import.meta.env.PROD === true;
}

/** The PROD allow-list. DEV sends every kind. */
export function passesProdFilter(record: DevlogInput): boolean {
  if (record.kind === 'error' || record.kind === 'freeze') return true;
  if (record.kind === 'ipc_slow') {
    const ms = record.fields.duration_ms;
    return typeof ms === 'number' && ms >= PROD_IPC_SLOW_MS;
  }
  return false;
}

function currentRoute(): string | undefined {
  try {
    const route = readRoute?.();
    return typeof route === 'string' && route ? route : undefined;
  } catch {
    // A store that is mid-teardown must not cost the record itself.
    return undefined;
  }
}

function stamp(input: DevlogInput): DevlogRecord {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.fields)) {
    if (v !== undefined) fields[k] = v; // absent value = key omitted
  }
  const record: DevlogRecord = { ...input, fields, cts: Date.now() };
  const route = currentRoute();
  if (route) record.route = route;
  return record;
}

/** Queue one record. Never throws, never logs. */
export function devlog(input: DevlogInput): void {
  if (isProdBuild() && !passesProdFilter(input)) return;
  ring.push(stamp(input));
  if (ring.length > DEVLOG_RING_SIZE) {
    ring.shift();
    dropped += 1;
  }
  if (!send) return;
  if (ring.length >= DEVLOG_FLUSH_AT) void flushDevlog();
  else requestDevlogFlush();
}

/**
 * Ask for a flush within {@link DEVLOG_FLUSH_INTERVAL_MS}. Producers that
 * accumulate outside the ring (the IPC window) call this so their window is
 * drained even when no record was queued.
 */
export function requestDevlogFlush(): void {
  if (!send || flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushDevlog();
  }, DEVLOG_FLUSH_INTERVAL_MS);
}

/** Register a source drained into each flush (e.g. the per-window IPC stats). */
export function registerDevlogContributor(fn: Contributor): () => void {
  contributors.add(fn);
  return () => {
    contributors.delete(fn);
  };
}

/** Where `route` comes from; read lazily at record time, never subscribed. */
export function setDevlogRouteReader(fn: (() => string | null | undefined) | null): void {
  readRoute = fn;
}

function drainBatch(): DevlogRecord[] {
  const batch: DevlogRecord[] = [];
  // Ring overflow is reported as its own record (all modes): a counted loss
  // of the instrument itself, which the PROD allow-list must not hide.
  if (dropped > 0) {
    batch.push(stamp({
      kind: 'swallow_rollup',
      lvl: 'warn',
      scope: 'devlog',
      msg: 'devlog records dropped',
      fields: { tag: 'devlog:ring_overflow', count: dropped },
    }));
    dropped = 0;
  }
  batch.push(...ring.splice(0, ring.length));
  for (const contribute of contributors) {
    for (const input of contribute()) {
      if (isProdBuild() && !passesProdFilter(input)) continue;
      batch.push(stamp(input));
    }
  }
  return batch;
}

function noteFlushFailure(err: unknown): void {
  if (!import.meta.env.DEV) return;
  const now = Date.now();
  if (now - lastFailureWarnAt < FAILURE_WARN_INTERVAL_MS) return;
  lastFailureWarnAt = now;
  // The one sanctioned console site of the devlog door: routing this through
  // log/silentCatch would queue a record about failing to drain the queue.
  console.warn('[devlog] flush failed; batch dropped', err);
}

/** Send everything pending now. Resolves once the attempt settled; never rejects. */
export async function flushDevlog(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const transport = send;
  if (!transport) return;
  const batch = drainBatch();
  if (batch.length === 0) return;
  try {
    await transport(batch);
  } catch (err) {
    noteFlushFailure(err);
  }
}

// --- install / teardown ------------------------------------------------------

// One slot on globalThis, because what install registers outlives this module:
// a `pagehide` and a `visibilitychange` listener on window/document and the
// long-task observer. A second copy of this module (HMR re-evaluation) would
// otherwise add a second set; the slot lets the new install tear the old down.
const TEARDOWN_SLOT = Symbol.for('personas.devlog.teardown');
type TeardownHost = typeof globalThis & { [TEARDOWN_SLOT]?: () => void };

export interface DevlogBufferInstall {
  send: Send;
  /** Extra teardown (e.g. the long-task observer's disconnect). */
  onTeardown?: () => void;
}

export function installDevlogBuffer(opts: DevlogBufferInstall): () => void {
  const host = globalThis as TeardownHost;
  host[TEARDOWN_SLOT]?.();

  send = opts.send;
  const onPageHide = () => {
    void flushDevlog();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') void flushDevlog();
  };
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibility);

  const teardown = () => {
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onVisibility);
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    send = null;
    opts.onTeardown?.();
    if (host[TEARDOWN_SLOT] === teardown) host[TEARDOWN_SLOT] = undefined;
  };
  host[TEARDOWN_SLOT] = teardown;

  // Records queued before install (early boot) leave on the normal cadence.
  if (ring.length >= DEVLOG_FLUSH_AT) void flushDevlog();
  else if (ring.length > 0 || dropped > 0) requestDevlogFlush();
  return teardown;
}

/** Read-only view for tests and diagnostics. */
export function getDevlogPending(): { queued: number; dropped: number } {
  return { queued: ring.length, dropped };
}

/** Test-only: tear down any install and empty the ring. */
export function __resetDevlogForTests(): void {
  (globalThis as TeardownHost)[TEARDOWN_SLOT]?.();
  ring.length = 0;
  dropped = 0;
  send = null;
  readRoute = null;
  lastFailureWarnAt = 0;
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
}
