/**
 * releaseCompositions - the Release card's composition per product, read
 * lazily (spark one-control, WP3).
 *
 * The products row says THAT a release card is due; the version it suggests
 * and the items it holds live in the store, so they need the snapshot. A
 * snapshot is up to a few MB, so it is never read on the counts tick: only
 * while a lane that deals release cards is open (`useReleaseCompositions`),
 * and only for products whose release card changed since the last read (a
 * signature over the row). The sheet reads through the same cache.
 *
 * A read that fails leaves the card without a version (it still counts and
 * still opens) and is logged once, quietly.
 *
 * Module state, read through `useSyncExternalStore`; the test hatch resets it.
 */
import { useEffect, useSyncExternalStore } from 'react';

import { getLensScanSnapshot, type LensScanProduct } from '@/api/lensScan';
import { mapWithConcurrency } from '@/lib/concurrency';
import { silentCatch } from '@/lib/silentCatch';

import { releaseWaits } from './lensKinds';
import { composeRelease, type ReleaseComposition } from './releaseComposition';

interface Entry {
  sig: string;
  value: ReleaseComposition | null;
  failed: boolean;
  pending: Promise<ReleaseComposition> | null;
  /** Resolves once the read is recorded here, landed or failed; never rejects. */
  settled: Promise<void>;
}

/** Snapshots read at once: a release card is rare, and a snapshot is large. */
const READS = 2;

let entries = new Map<string, Entry>();
let version = 0;
const listeners = new Set<() => void>();

function publish(): void {
  version += 1;
  for (const l of listeners) l();
}

/** What changes when the release card's content can have changed. */
export function releaseSignature(p: LensScanProduct): string {
  return [
    p.storeVersion,
    p.unreleasedAccepted,
    p.openRelease ? `${p.openRelease.id}:${p.openRelease.status}` : '',
    JSON.stringify(p.counts),
    p.lastRunAt ?? '',
  ].join('|');
}

/** Start (or join) the read for this row; the entry records how it ended. */
function read(p: LensScanProduct): Entry {
  const sig = releaseSignature(p);
  const hit = entries.get(p.projectId);
  if (hit && hit.sig === sig && (hit.value || hit.pending)) return hit;
  const pending = getLensScanSnapshot(p.projectId).then((snap) => composeRelease(snap.scan));
  const record = (value: ReleaseComposition | null) => {
    if (entries.get(p.projectId)?.pending !== pending) return;
    entries.set(p.projectId, { sig, value, failed: value === null, pending: null, settled: Promise.resolve() });
    publish();
  };
  const settled = pending.then(record, (err: unknown) => {
    // A failed read is recorded as failed, never as an empty composition.
    silentCatch(`decisionCenter.lensRelease:${p.projectId}`)(err);
    record(null);
  });
  const entry: Entry = { sig, value: null, failed: false, pending, settled };
  entries.set(p.projectId, entry);
  return entry;
}

/** The composition for this product, from the cache when its row has not changed. Rejects as the read did. */
export function loadComposition(p: LensScanProduct): Promise<ReleaseComposition> {
  const e = read(p);
  return e.value ? Promise.resolve(e.value) : e.pending ?? Promise.reject(new Error(`no release read for ${p.projectId}`));
}

/** Read every due composition this row set lacks. Never rejects. */
export async function ensureCompositions(products: readonly LensScanProduct[]): Promise<void> {
  const due = products.filter((p) => {
    if (p.error || !releaseWaits(p)) return false;
    const hit = entries.get(p.projectId);
    // A failed read is not retried until the row changes: the card still opens.
    return !hit || hit.sig !== releaseSignature(p);
  });
  await mapWithConcurrency(due, READS, (p) => read(p).settled);
}

function compositionsOf(): ReadonlyMap<string, ReleaseComposition> {
  const out = new Map<string, ReleaseComposition>();
  for (const [id, e] of entries) if (e.value) out.set(id, e.value);
  return out;
}

let cached: { at: number; map: ReadonlyMap<string, ReleaseComposition> } = { at: -1, map: new Map() };
function snapshot(): ReadonlyMap<string, ReleaseComposition> {
  if (cached.at !== version) cached = { at: version, map: compositionsOf() };
  return cached.map;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The compositions known so far, reading the due ones while `active`. */
export function useReleaseCompositions(
  products: readonly LensScanProduct[] | null,
  active: boolean,
): ReadonlyMap<string, ReleaseComposition> {
  const map = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (active && products) void ensureCompositions(products);
  }, [active, products]);
  return map;
}

/** Test hatch - module state must not leak between tests. */
export function resetReleaseCompositions(): void {
  entries = new Map();
  version = 0;
  cached = { at: -1, map: new Map() };
  listeners.clear();
}
