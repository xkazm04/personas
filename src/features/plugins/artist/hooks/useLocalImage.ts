import { useState, useEffect } from 'react';
import { artistReadImageBase64 } from '@/api/artist';

/**
 * Module-level cache keyed by filePath. Keeps thumbnails in memory across
 * unmount/remount (masonry grids remount on sort/filter changes). The cache
 * is capped so a directory with thousands of assets can't exhaust memory —
 * the oldest entries are evicted in insertion order.
 */
const MAX_CACHE_ENTRIES = 300;
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function putInCache(filePath: string, dataUrl: string) {
  // Move to end (LRU-ish via Map insertion order)
  if (cache.has(filePath)) cache.delete(filePath);
  cache.set(filePath, dataUrl);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/**
 * Load a local image file as a base64 data URL via Tauri IPC.
 * Returns the data URL once loaded, or null while loading/on error.
 *
 * Results are cached at module scope so repeated mounts of the same path
 * (common in reactive grids) resolve synchronously without another IPC hop.
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

  return dataUrl;
}
