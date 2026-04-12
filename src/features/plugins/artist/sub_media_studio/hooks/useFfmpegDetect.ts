import { useState, useEffect, useCallback } from 'react';
import { artistCheckFfmpeg, type FfmpegStatus } from '@/api/artist/index';

/**
 * Detect whether FFmpeg is available on the host machine.
 * Caches the result in local state and provides a manual recheck.
 */
export function useFfmpegDetect() {
  const [status, setStatus] = useState<FfmpegStatus | null>(null);
  const [checking, setChecking] = useState(true);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const result = await artistCheckFfmpeg();
      setStatus(result);
    } catch {
      setStatus({ found: false, path: null, version: null });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return { status, checking, recheck: check };
}
