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
 * React-free.
 */
import {
  decideLensScan,
  getLensScanCommitDiff,
  getLensScanShot,
  getLensScanSnapshot,
  startLensScan,
  triageLensScan,
} from '@/api/lensScan';

import type { BlueprintActions, BlueprintData, BlueprintProduct } from '../source';

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

/** Read one product into the drawing's data. */
export async function readBlueprint(product: BlueprintProduct): Promise<BlueprintData> {
  const snap = await getLensScanSnapshot(product.projectId);
  return { product, structure: snap.structure, events: snap.events, scan: snap.scan, storeVersion: snap.storeVersion };
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
  };
}
