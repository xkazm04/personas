import { useState, useEffect } from 'react';
import { artistReadImageBase64 } from '@/api/artist';

/**
 * Module-level cache keyed by filePath. Keeps decoded data URLs in memory
 * across unmount/remount (masonry grids remount on sort/filter changes).
 *
 * The cache is bounded by a TOTAL-BYTE budget rather than an entry count:
 * artist assets are full-resolution AI images (commonly 1–4 MB, ≈1.33× as a
 * base64 data URL), so a fixed entry cap could still pin multiple gigabytes of
 * renderer heap. We track the accumulated data-URL length and evict the
 * least-recently-used entries until we're back under budget. Large entries are
 * additionally released when their last on-screen consumer unmounts, so the
 * cache doesn't hold full-res base64 for the whole app lifetime after the user
 * leaves the gallery.
 *
 * NOTE: a proper fix also generates downscaled thumbnails at scan time so the
 * grid never decodes full-res images at all — tracked as a backend follow-up.
 */
const MAX_CACHE_BYTES = 96 * 1024 * 1024; // ~96 MB of base64 data URLs
const LARGE_ENTRY_BYTES = 512 * 1024; // entries this big are evicted on last unmount

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
// Number of currently-mounted consumers per path, so we can release large
// entries once nothing on screen is showing them.
const refCounts = new Map<string, number>();
let cacheBytes = 0;

function dropFromCache(filePath: string) {
  const existing = cache.get(filePath);
  if (existing !== undefined) {
    cacheBytes -= existing.length;
    cache.delete(filePath);
  }
}

function putInCache(filePath: string, dataUrl: string) {
  // Replace any prior value (and its byte accounting), then re-insert at the
  // end so Map iteration order doubles as an LRU queue.
  dropFromCache(filePath);
  cache.set(filePath, dataUrl);
  cacheBytes += dataUrl.length;

  // Evict least-recently-used entries until we're under the byte budget. Never
  // evict the entry we just inserted, even if it alone exceeds the budget.
  while (cacheBytes > MAX_CACHE_BYTES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined || oldest === filePath) break;
    dropFromCache(oldest);
  }
}

function touchCache(filePath: string) {
  // Move an existing entry to the end of the LRU queue on access.
  const existing = cache.get(filePath);
  if (existing === undefined) return;
  cache.delete(filePath);
  cache.set(filePath, existing);
}

/**
 * Evict a cached data-URL (and any in-flight load) for a path. Call this when
 * an asset is deleted or renamed — otherwise the stale base64 lingers in the
 * cache and would be served if the path is later reused, showing the wrong
 * (old) image.
 */
export function invalidateLocalImage(filePath: string) {
  dropFromCache(filePath);
  inflight.delete(filePath);
}

/**
 * Load a local image file as a base64 data URL via Tauri IPC.
 * Returns the data URL once loaded, or null while loading/on error.
 *
 * Results are cached at module scope (bounded by a byte budget) so repeated
 * mounts of the same path (common in reactive grids) resolve synchronously
 * without another IPC hop.
 */
export function useLocalImage(filePath: string | null | undefined) {
  const cached = filePath ? cache.get(filePath) ?? null : null;
  const [dataUrl, setDataUrl] = useState<string | null>(cached);

  useEffect(() => {
    if (!filePath) {
      setDataUrl(null);
      return;
    }
    const hit = cache.get(filePath);
    if (hit) {
      touchCache(filePath);
      setDataUrl(hit);
      return;
    }

    let cancelled = false;
    let promise = inflight.get(filePath);
    if (!promise) {
      promise = artistReadImageBase64(filePath).then((url) => {
        putInCache(filePath, url);
        inflight.delete(filePath);
        return url;
      });
      inflight.set(filePath, promise);
      promise.catch(() => inflight.delete(filePath));
    }
    promise
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setDataUrl(null); });
    return () => { cancelled = true; };
  }, [filePath]);

  // Track on-screen consumers per path. When the last consumer of a large
  // (full-resolution) entry unmounts, drop it from the cache so the renderer
  // doesn't pin megabytes of base64 for the app's lifetime after the gallery
  // closes. Small entries (e.g. real downscaled thumbnails, once generated) are
  // kept so they survive sort/filter remounts.
  useEffect(() => {
    if (!filePath) return;
    refCounts.set(filePath, (refCounts.get(filePath) ?? 0) + 1);
    return () => {
      const next = (refCounts.get(filePath) ?? 1) - 1;
      if (next <= 0) {
        refCounts.delete(filePath);
        const entry = cache.get(filePath);
        if (entry !== undefined && entry.length >= LARGE_ENTRY_BYTES) {
          dropFromCache(filePath);
        }
      } else {
        refCounts.set(filePath, next);
      }
    };
  }, [filePath]);

  return dataUrl;
}
