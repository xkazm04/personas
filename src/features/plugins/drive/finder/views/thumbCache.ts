import type { DriveEntry, DriveThumbEdge } from "@/api/drive";
import { driveThumbnail } from "@/api/drive";
import { silentCatch } from "@/lib/silentCatch";

/** Module-level LRU of object URLs; entries past this many are revoked. */
export const THUMB_CACHE_MAX = 300;

const urls = new Map<string, string>();
const failed = new Set<string>();
const inflight = new Map<string, Promise<string | null>>();

export function thumbKey(entry: DriveEntry, edge: DriveThumbEdge): string {
  return `${entry.path}|${entry.modified}|${entry.size}|${edge}`;
}

export function cachedThumb(key: string): string | null {
  const url = urls.get(key);
  if (url === undefined) return null;
  // Touch: re-insert so Map order doubles as recency.
  urls.delete(key);
  urls.set(key, url);
  return url;
}

export function thumbFailed(key: string): boolean {
  return failed.has(key);
}

function remember(key: string, url: string): void {
  urls.set(key, url);
  while (urls.size > THUMB_CACHE_MAX) {
    const oldest = urls.keys().next().value;
    if (oldest === undefined) break;
    const victim = urls.get(oldest);
    urls.delete(oldest);
    if (victim) URL.revokeObjectURL(victim);
  }
}

/**
 * Resolve a thumbnail URL, asking the backend at most once per key per
 * session: hits come from the LRU, failures are memoised, and concurrent
 * callers share one in-flight request. Never rejects.
 */
export function requestThumb(entry: DriveEntry, edge: DriveThumbEdge): Promise<string | null> {
  const key = thumbKey(entry, edge);
  const hit = cachedThumb(key);
  if (hit) return Promise.resolve(hit);
  if (failed.has(key)) return Promise.resolve(null);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = driveThumbnail(entry.path, edge)
    .then((buf) => {
      const url = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
      remember(key, url);
      return url;
    })
    .catch((err: unknown) => {
      silentCatch("drive:thumbnail")(err);
      failed.add(key);
      return null;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/** Test seam: drop every memo and revoke every URL. */
export function resetThumbCache(): void {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  failed.clear();
  inflight.clear();
}
