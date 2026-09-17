import { useEffect, useState } from "react";
import type { RefObject } from "react";

import type { DriveEntry, DriveThumbEdge } from "@/api/drive";
import { isImageEntry } from "./kindVisual";
import { cachedThumb, requestThumb, thumbFailed, thumbKey } from "./thumbCache";

export interface ThumbState {
  url: string | null;
  failed: boolean;
}

const IDLE: ThumbState = { url: null, failed: false };

/**
 * Lazily resolve an image entry's thumbnail once the observed element comes
 * within 300px of the viewport. URLs live in the module LRU (`thumbCache`),
 * so a tile that scrolls away and back never re-asks the backend, and a file
 * the backend rejects is asked exactly once per session. Non-images resolve
 * to `{ url: null, failed: false }` without observing anything.
 */
export function useThumbnail(
  entry: DriveEntry,
  edge: DriveThumbEdge,
  ref: RefObject<HTMLElement | null>,
): ThumbState {
  const key = isImageEntry(entry) ? thumbKey(entry, edge) : null;
  const [state, setState] = useState<ThumbState>(() =>
    key ? { url: cachedThumb(key), failed: thumbFailed(key) } : IDLE,
  );

  useEffect(() => {
    if (!key) return;
    const hit = cachedThumb(key);
    if (hit) {
      setState({ url: hit, failed: false });
      return;
    }
    if (thumbFailed(key)) {
      setState({ url: null, failed: true });
      return;
    }
    setState(IDLE);
    let cancelled = false;
    let asked = false;
    const ask = () => {
      if (asked) return;
      asked = true;
      void requestThumb(entry, edge).then((url) => {
        if (!cancelled) setState({ url, failed: url === null });
      });
    };
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      ask();
      return () => {
        cancelled = true;
      };
    }
    const io = new IntersectionObserver(
      (records) => {
        if (records.some((r) => r.isIntersecting)) {
          ask();
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
    // `entry` is fully captured by `key` (path|modified|size|edge).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ref]);

  return key ? state : IDLE;
}
