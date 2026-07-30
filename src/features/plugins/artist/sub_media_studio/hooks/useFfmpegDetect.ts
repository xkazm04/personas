import { useState, useEffect, useCallback, useRef } from 'react';
import { artistCheckFfmpeg, type FfmpegStatus } from '@/api/artist/index';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Module-scoped warm cache (mirrors `LifecyclePage`/`CompetitionList`):
 * `MediaStudioPage` fully unmounts when the Artist tab strip switches away
 * (see `ArtistPage`'s `artistTab === 'media-studio'` branch), so a plain
 * `useState(null)` re-triggered `checking` on every remount and flashed the
 * `LoadingSpinner` banner over an already-known "ffmpeg found" badge — a
 * ghost-over-content regression the loading doctrine forbids. Caching here
 * lets a warm remount paint the last known status on the first frame while
 * `check()` still refreshes it silently in the background.
 */
let cachedFfmpegStatus: FfmpegStatus | null = null;

/**
 * Detect whether FFmpeg is available on the host machine.
 *
 * The first check is deferred via `requestIdleCallback` so mounting the
 * Media Studio tab never blocks on a subprocess call. The Rust command is
 * itself fully async, but running it during the commit phase still costs
 * main-thread work we'd rather delay until the browser is idle.
 */
export function useFfmpegDetect() {
  const [status, setStatus] = useState<FfmpegStatus | null>(cachedFfmpegStatus);
  const [checking, setChecking] = useState(false);
  const mountedRef = useRef(true);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const result = await artistCheckFfmpeg();
      if (!mountedRef.current) return;
      cachedFfmpegStatus = result;
      setStatus(result);
    } catch {
      if (!mountedRef.current) return;
      const fallback: FfmpegStatus = { found: false, path: null, version: null };
      cachedFfmpegStatus = fallback;
      setStatus(fallback);
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // Warm remount: a cached status already paints on the first frame above,
    // so the (still deferred) idle check only needs to refresh it silently —
    // no need to force `checking` back on and re-show the banner's spinner
    // state for data that's already on screen (law 1).
    const idle =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(() => check(), { timeout: 2000 })
        : (setTimeout(() => check(), 0) as unknown as number);
    return () => {
      mountedRef.current = false;
      if (typeof cancelIdleCallback === 'function') {
        try {
          cancelIdleCallback(idle as number);
        } catch (err) { silentCatch("features/plugins/artist/sub_media_studio/hooks/useFfmpegDetect:catch1")(err); }
      } else {
        clearTimeout(idle as unknown as number);
      }
    };
  }, [check]);

  return { status, checking, recheck: check };
}
