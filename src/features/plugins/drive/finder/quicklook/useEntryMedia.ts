import { useEffect, useState } from "react";

import { driveRead, driveReadText, type DriveEntry } from "@/api/drive";
import { silentCatch } from "@/lib/silentCatch";
import { previewKind } from "../types";

export const TEXT_MAX_BYTES = 256 * 1024;
export const TEXT_CUT_CHARS = 200 * 1024;

export type MediaState = "loading" | "ready" | "failed" | "too_large";

export interface EntryMedia {
  kind: ReturnType<typeof previewKind>;
  state: MediaState;
  /** Blob URL for image / video / audio / pdf. */
  url: string | null;
  /** Decoded text for the text kind (cut at TEXT_CUT_CHARS). */
  text: string | null;
  truncated: boolean;
}

/**
 * Reads an entry's bytes into a blob URL (or its text for the text kind)
 * with the stale-read guard from the classic renderer: a read that resolves
 * after the entry changed never lands, and its URL is revoked instead of
 * handed to a caller that would apply it unconditionally.
 */
export function useEntryMedia(entry: DriveEntry | null): EntryMedia {
  const kind = entry ? previewKind(entry) : null;
  const path = entry?.path ?? "";
  const mime = entry?.mime ?? null;
  const size = entry?.size ?? 0;

  const [media, setMedia] = useState<EntryMedia>({
    kind,
    state: "loading",
    url: null,
    text: null,
    truncated: false,
  });

  useEffect(() => {
    let cancelled = false;
    let owned: string | null = null;
    const base = { kind, url: null, text: null, truncated: false } as const;

    if (!path || kind === null) {
      setMedia({ ...base, state: "ready" });
      return;
    }
    setMedia({ ...base, state: "loading" });

    if (kind === "text") {
      if (size > TEXT_MAX_BYTES) {
        setMedia({ ...base, state: "too_large" });
        return;
      }
      driveReadText(path)
        .then((content) => {
          if (cancelled) return;
          const truncated = content.length > TEXT_CUT_CHARS;
          setMedia({
            ...base,
            state: "ready",
            text: truncated ? content.slice(0, TEXT_CUT_CHARS) : content,
            truncated,
          });
        })
        .catch((err) => {
          silentCatch("drive:finder:read-text")(err);
          if (!cancelled) setMedia({ ...base, state: "failed" });
        });
      return () => {
        cancelled = true;
      };
    }

    driveRead(path)
      .then((bytes) => {
        if (cancelled) return;
        const blob = new Blob([new Uint8Array(bytes)], {
          type: mime ?? "application/octet-stream",
        });
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        owned = url;
        setMedia({ ...base, state: "ready", url });
      })
      .catch((err) => {
        silentCatch("drive:finder:read-media")(err);
        if (!cancelled) setMedia({ ...base, state: "failed" });
      });

    return () => {
      cancelled = true;
      if (owned) URL.revokeObjectURL(owned);
    };
  }, [path, mime, size, kind]);

  return media;
}
