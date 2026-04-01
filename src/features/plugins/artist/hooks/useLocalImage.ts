import { useState, useEffect } from 'react';
import { artistReadImageBase64 } from '@/api/artist';

/**
 * Load a local image file as a base64 data URL via Tauri IPC.
 * Returns the data URL once loaded, or null while loading/on error.
 */
export function useLocalImage(filePath: string | null | undefined) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    artistReadImageBase64(filePath)
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setDataUrl(null); });
    return () => { cancelled = true; };
  }, [filePath]);

  return dataUrl;
}
