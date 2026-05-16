import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import { driveRead, type DriveEntry } from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";
import { silentCatch } from "@/lib/silentCatch";

interface Props {
  entries: DriveEntry[];
  initialPath: string;
  onClose: () => void;
}

export function DriveImageLightbox({ entries, initialPath, onClose }: Props) {
  const { t, tx } = useTranslation();
  const [index, setIndex] = useState(() =>
    Math.max(0, entries.findIndex((e) => e.path === initialPath)),
  );
  const total = entries.length;
  const current = entries[index] ?? null;

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + total) % total);
  }, [total]);
  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % total);
  }, [total]);

  // Global keyboard: Esc closes, arrows cycle. We attach to document so the
  // shortcuts work even though the lightbox itself is a portaled div and
  // doesn't naturally hold focus on every browser.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, goPrev, goNext]);

  // Fetch the current entry's bytes once and wrap them in a blob URL.
  // We revoke the URL whenever the entry changes so we don't leak.
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    if (!current) return;
    let revoked: string | null = null;
    let cancelled = false;
    setState("loading");
    setUrl(null);

    driveRead(current.path)
      .then((bytes) => {
        if (cancelled) return;
        const blob = new Blob([new Uint8Array(bytes)], {
          type: current.mime ?? "application/octet-stream",
        });
        const u = URL.createObjectURL(blob);
        revoked = u;
        setUrl(u);
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        silentCatch("drive:lightbox-load")(err);
        setState("failed");
      });

    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [current]);

  if (!current) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.name}
      className="fixed inset-0 z-[100] flex flex-col bg-background/95 backdrop-blur-md"
      onClick={onClose}
    >
      {/* Chrome bar */}
      <div
        className="flex items-center justify-between gap-3 px-5 py-3 border-b border-primary/10 bg-background/80"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 min-w-0">
          <div className="typo-section-title truncate">{current.name}</div>
          <div className="typo-caption text-foreground font-mono truncate">
            {current.path}
          </div>
        </div>
        {total > 1 && (
          <div className="typo-body text-foreground tabular-nums px-3 py-1 rounded-full bg-secondary/40 border border-primary/15">
            {tx(t.plugins.drive.lightbox_counter, {
              current: index + 1,
              total,
            })}
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-card bg-secondary/40 border border-primary/15 hover:bg-secondary/70 hover:border-primary/25 typo-body text-foreground transition-colors"
          aria-label={t.plugins.drive.lightbox_close}
          title={t.plugins.drive.lightbox_close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Image stage */}
      <div
        className="relative flex-1 min-h-0 flex items-center justify-center p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {total > 1 && (
          <button
            type="button"
            onClick={goPrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-12 h-12 rounded-full bg-secondary/50 border border-primary/15 hover:bg-cyan-500/25 hover:border-cyan-500/40 text-foreground hover:text-cyan-100 transition-colors shadow-elevation-2"
            aria-label={t.plugins.drive.lightbox_prev}
            title={t.plugins.drive.lightbox_prev}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        {state === "loading" && (
          <div className="typo-body text-foreground italic">
            {t.plugins.drive.lightbox_loading}
          </div>
        )}
        {state === "failed" && (
          <div className="typo-body text-rose-300">
            {t.plugins.drive.lightbox_failed}
          </div>
        )}
        {state === "ready" && url && (
          <img
            src={url}
            alt={current.name}
            className="max-w-full max-h-full object-contain rounded-card shadow-elevation-3"
          />
        )}
        {total > 1 && (
          <button
            type="button"
            onClick={goNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-12 h-12 rounded-full bg-secondary/50 border border-primary/15 hover:bg-cyan-500/25 hover:border-cyan-500/40 text-foreground hover:text-cyan-100 transition-colors shadow-elevation-2"
            aria-label={t.plugins.drive.lightbox_next}
            title={t.plugins.drive.lightbox_next}
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
