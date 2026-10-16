/**
 * lensScanSource - the ONE `lens_scan_products` read app-wide (spark
 * one-control, WP3).
 *
 * A warm slot, the posture of `useDecisionSources`: the last rows that landed
 * survive unmount, so a reopened peek or deck paints them while it re-reads.
 * Unlike those chip sources it is also a COUNT source (the lens cards sit in
 * fixed lanes, `frontendLanes`, and the lane buttons count them), so it lives
 * beside `lanesSnapshotSource` with the same shape: one read in flight however
 * many readers are mounted, the last good rows kept, a failed read remembered
 * until the next success (a failed read is never an empty one).
 *
 * WHO re-reads it: the roster's counts refresh (`useDecisionCountsCore`), so
 * the 30 s tick, the roster's push events and a landed verdict; the blueprint's
 * live actions after every write; and the lens sheet when it closes.
 *
 * A product whose store did not open (`error` set) yields no card. It is said
 * ONCE, quietly (`silentCatch`), per product and message, never per poll and
 * never as a toast.
 *
 * Module state, read through `useSyncExternalStore`; the test hatch resets it.
 */
import { useEffect, useSyncExternalStore } from 'react';

import { listLensScanProducts, type LensScanProduct } from '@/api/lensScan';
import { silentCatch } from '@/lib/silentCatch';

export interface LensScanSourceState {
  /** The last rows that landed (store errors included), or null before any. */
  products: LensScanProduct[] | null;
  /** The last read failed. `products` is the last good answer. */
  failed: boolean;
  /** At least one read has settled. */
  settled: boolean;
}

/** The source's name in a lane's failed-sources tooltip. */
export const LENS_SCAN_SOURCE = 'lens_scan_products';

let state: LensScanSourceState = { products: null, failed: false, settled: false };
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();
/** `<projectId>|<message>` already said once. */
const said = new Set<string>();

function publish(next: LensScanSourceState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeLensScan(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLensScanState(): LensScanSourceState {
  return state;
}

function sayStoreErrors(rows: readonly LensScanProduct[]): void {
  for (const p of rows) {
    if (!p.error) continue;
    const key = `${p.projectId}|${p.error}`;
    if (said.has(key)) continue;
    said.add(key);
    silentCatch(`decisionCenter.lensScan:${p.projectId}`)(new Error(p.error));
  }
}

/** Read the products once. Never rejects: the failure is the state. */
export function refreshLensScanProducts(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = listLensScanProducts()
    .then((rows) => {
      // The command always answers an array; a mocked or absent door answers
      // nothing, which is no product rather than a failure.
      const products = Array.isArray(rows) ? rows : [];
      sayStoreErrors(products);
      publish({ products, failed: false, settled: true });
    })
    .catch((err: unknown) => {
      silentCatch('decisionCenter.lensScan')(err);
      publish({ ...state, failed: true, settled: true });
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** The shared products, read once on mount while `enabled`. */
export function useLensScanProducts(enabled: boolean): LensScanSourceState {
  const current = useSyncExternalStore(subscribeLensScan, getLensScanState);
  useEffect(() => {
    if (enabled) void refreshLensScanProducts();
  }, [enabled]);
  return current;
}

/** Test hatch - module state must not leak between tests. */
export function resetLensScanSource(): void {
  state = { products: null, failed: false, settled: false };
  inFlight = null;
  listeners.clear();
  said.clear();
}
