/**
 * liveActions - `BlueprintActions` over WP2's lens-scan doors (spark
 * one-control, Stage 2, WP3). The drawing writes only through this seam
 * (`blueprint/source.ts`); here every action maps 1:1 onto `@/api/lensScan`.
 *
 * Nothing here pre-checks a transition: the store's answer (`skipped[]` and
 * its reasons included) passes through unchanged, and a refusal rejects as the
 * door rejected it. After every write (settled either way: a refused write may
 * still have moved part of the batch) `onChanged` runs, so the Decision
 * Center's counts and cards re-read the products.
 *
 * Every read also carries the products for the header's project switcher and
 * the open product's last scan (spark bp-fidelity): the same shared products
 * read the Monitor's project list draws from, re-read with the snapshot so a
 * switcher opened after a write shows the store's new counts. `openProduct`
 * reopens the sheet on another product through `lensSheetStore`; the host
 * keys the sheet by product, so the drawing remounts from scratch.
 *
 * React-free.
 */
import {
  decideLensScan,
  getLensScanCommitDiff,
  getLensScanShot,
  getLensScanSnapshot,
  startLensScan,
  triageLensScan,
  type LensScanProduct,
} from '@/api/lensScan';

import { liveFollower } from '../../lens/bpFollowLive';
import { openLensSheet } from '../../lens/lensSheetStore';
import { readinessLevel } from '../../lens/readiness';
import { getLensScanState, refreshLensScanProducts } from '../../roster/lensScanSource';
import type { BlueprintActions, BlueprintData, BlueprintProduct, BlueprintProductEntry } from '../source';

/** The MIME of a `shots` file, from its extension (the door serves exactly these). */
const SHOT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  webm: 'video/webm',
};

export function shotMime(path: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  return SHOT_MIME[ext] ?? 'application/octet-stream';
}

/**
 * The door answers raw bytes (`tauri::ipc::Response`), which arrive as an
 * ArrayBuffer; a JSON-serialised byte array (a mocked door) is accepted too.
 */
function asBytes(data: ArrayBuffer | ArrayLike<number>): BlobPart {
  return data instanceof ArrayBuffer ? data : new Uint8Array(Array.from(data));
}

/** One products row as the switcher's entry: its readiness level and open proposals. */
export function productEntry(p: LensScanProduct): BlueprintProductEntry {
  const entry: BlueprintProductEntry = {
    projectId: p.projectId,
    name: p.name,
    level: readinessLevel(p),
    proposals: p.counts.proposed ?? 0,
  };
  if (p.lastRunAt) entry.lastRunAt = p.lastRunAt;
  if (p.error) entry.error = p.error;
  return entry;
}

/** Read one product into the drawing's data, with every product for the switcher. */
export async function readBlueprint(product: BlueprintProduct): Promise<BlueprintData> {
  // The products read never rejects (a failed read keeps the last good rows); it joins one in flight.
  const [snap] = await Promise.all([getLensScanSnapshot(product.projectId), refreshLensScanProducts()]);
  const rows = getLensScanState().products ?? [];
  const data: BlueprintData = {
    product,
    products: rows.map(productEntry),
    structure: snap.structure,
    events: snap.events,
    scan: snap.scan,
    storeVersion: snap.storeVersion,
  };
  const lastRunAt = rows.find((p) => p.projectId === product.projectId)?.lastRunAt;
  if (lastRunAt) data.lastRunAt = lastRunAt;
  return data;
}

/** Reopen the sheet on another product (the header's project switcher). */
export function openProduct(projectId: string): void {
  openLensSheet({ kind: 'build', projectId });
}

export function createLiveActions(product: BlueprintProduct, onChanged: () => void): BlueprintActions {
  const id = product.projectId;
  const written = <T>(p: Promise<T>): Promise<T> => p.finally(onChanged);
  return {
    decide: (ids, decision, note) => written(decideLensScan(id, ids, decision, note)),
    triage: (ids, decision, note) => written(triageLensScan(id, ids, decision, note)),
    start: (request) => written(startLensScan(id, request)),
    commitDiff: (sha) => getLensScanCommitDiff(id, sha),
    shotUrl: async (path) => {
      const bytes = await getLensScanShot(id, path);
      return URL.createObjectURL(new Blob([asBytes(bytes)], { type: shotMime(path) }));
    },
    refresh: () => readBlueprint(product),
    openProduct,
    follow: liveFollower(),
  };
}
