import { useEffect, useRef, useState } from "react";

import { driveRead } from "@/api/drive";
import { silentCatch } from "@/lib/silentCatch";

/**
 * Lazily load an image file's bytes as a blob URL while the observed element
 * is near the viewport, and free the blob again once it scrolls away — so a
 * folder of hundreds of images never holds more than the visible window in
 * memory. IntersectionObserver accounts for ancestor clipping (overflow
 * containers), so a viewport root works for both vertical grids and
 * horizontal strips.
 *
 * Returns a ref to attach to the tile element and the current object URL
 * (null while unloaded / off-screen / not an image). Pass `enabled=false`
 * for non-image entries to skip observation entirely.
 */
export function useLazyImageThumb<T extends HTMLElement>(
  path: string,
  mime: string | null,
  enabled: boolean,
): { ref: React.RefObject<T | null>; url: string | null } {
  const ref = useRef<T | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  urlRef.current = url;

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (records) => {
        const rec = records[0];
        if (!rec) return;
        if (rec.isIntersecting) {
          if (urlRef.current || cancelled) return;
          driveRead(path)
            .then((bytes) => {
              if (cancelled) return;
              const u = URL.createObjectURL(
                new Blob([new Uint8Array(bytes)], {
                  type: mime ?? "application/octet-stream",
                }),
              );
              urlRef.current = u;
              setUrl(u);
            })
            .catch(silentCatch("drive:lazy-thumb"));
        } else if (urlRef.current) {
          // Off-screen → free the blob to bound memory on large image sets.
          URL.revokeObjectURL(urlRef.current);
          urlRef.current = null;
          setUrl(null);
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [path, mime, enabled]);

  return { ref, url };
}
