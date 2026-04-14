import { useState, useEffect, useCallback, useRef } from 'react';
import { artistCheckFfmpeg, type FfmpegStatus } from '@/api/artist/index';

/**
 * Detect whether FFmpeg is available on the host machine.
 *
 * The first check is deferred via `requestIdleCallback` so mounting the
 * Media Studio tab never blocks on a subprocess call. The Rust command is
 * itself fully async, but running it during the commit phase still costs
 * main-thread work we'd rather delay until the browser is idle.
 */
export function useFfmpegDetect() {
  const [status, setStatus] = useState<FfmpegStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const mountedRef = useRef(true);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const result = await artistCheckFfmpeg();
      if (!mountedRef.current) return;
      setStatus(result);
    } catch {
      if (!mountedRef.current) return;
      setStatus({ found: false, path: null, version: null });
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const idle =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(() => check(), { timeout: 2000 })
        : (setTimeout(() => check(), 0) as unknown as number);
    return () => {
      mountedRef.current = false;
      if (typeof cancelIdleCallback === 'function') {
        try {
          cancelIdleCallback(idle as number);
        } catch {
          /* ignore */
        }
      } else {
        clearTimeout(idle as unknown as number);
      }
    };
  }, [check]);

  return { status, checking, recheck: check };
}
