/**
 * Drive media lightbox — full-screen overlay for previewing files by
 * opening them. Despite the historical name (`DriveImageLightbox`), it
 * now handles images, video, and PDFs. The component is kept under the
 * old filename to minimise import-site churn; rename to
 * `DrivePreviewLightbox` is a follow-up.
 *
 * Per-kind behaviour:
 * - image/*           — zoom (+/-, mouse-wheel) / pan (drag) / rotate (R).
 * - video/*           — native <video controls autoplay>.
 * - application/pdf   — sandboxed <iframe> from a blob URL.
 *
 * Arrow keys cycle entries regardless of kind; +/-/0/R only fire on
 * images and the toolbar buttons hide for non-image entries.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { driveFormatBytes, driveRead, type DriveEntry } from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";
import { BaseModal } from "@/lib/ui/BaseModal";
import { silentCatch } from "@/lib/silentCatch";
import { formatRelativeTime, visualForEntry } from "../designTokens";

interface Props {
  entries: DriveEntry[];
  initialPath: string;
  onClose: () => void;
}

interface Transform {
  zoom: number;
  rotation: number;
  panX: number;
  panY: number;
}

type MediaKind = "image" | "video" | "pdf" | "other";

const IDENTITY: Transform = { zoom: 1, rotation: 0, panX: 0, panY: 0 };
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function kindFromEntry(entry: DriveEntry | null): MediaKind {
  if (!entry) return "other";
  const mime = entry.mime ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return "other";
}

export function DriveImageLightbox({ entries, initialPath, onClose }: Props) {
  const { t, tx } = useTranslation();
  const [index, setIndex] = useState(() =>
    Math.max(0, entries.findIndex((e) => e.path === initialPath)),
  );
  const total = entries.length;
  const current = entries[index] ?? null;
  const kind = kindFromEntry(current);

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + total) % total);
  }, [total]);
  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % total);
  }, [total]);

  // Transform state per-image. The lightbox keeps a map keyed by path
  // for the lifetime of the session — flipping prev/next restores the
  // zoom/rotation/pan you had on each image, which matters for
  // image-comparison workflows (e.g. two screenshots both pre-zoomed to
  // 200% to compare a region). The map clears on close (component
  // unmount), so re-opening the lightbox starts fresh.
  const transformsRef = useRef<Map<string, Transform>>(new Map());
  const currentPathKey = current?.path ?? "";
  const [transform, setTransformRaw] = useState<Transform>(IDENTITY);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  // Wrap setTransform so every state change also writes to the per-path
  // map. Consumers can keep calling setTransform / functional updaters —
  // the side-effect threads through.
  const setTransform = useCallback(
    (next: Transform | ((prev: Transform) => Transform)) => {
      setTransformRaw((prev) => {
        const resolved =
          typeof next === "function"
            ? (next as (p: Transform) => Transform)(prev)
            : next;
        if (currentPathKey) transformsRef.current.set(currentPathKey, resolved);
        return resolved;
      });
    },
    [currentPathKey],
  );
  // Restore the stored transform when entry changes; fall back to
  // identity if the user hasn't transformed this image yet.
  useEffect(() => {
    if (!currentPathKey) return;
    setTransformRaw(transformsRef.current.get(currentPathKey) ?? IDENTITY);
  }, [currentPathKey]);

  const zoomBy = useCallback(
    (factor: number, originX?: number, originY?: number) => {
      setTransform((prev) => {
        const next = clamp(prev.zoom * factor, MIN_ZOOM, MAX_ZOOM);
        if (next === prev.zoom) return prev;
        if (next <= MIN_ZOOM) return { ...prev, zoom: next, panX: 0, panY: 0 };
        if (originX !== undefined && originY !== undefined) {
          const scale = next / prev.zoom;
          return {
            ...prev,
            zoom: next,
            panX: originX - scale * (originX - prev.panX),
            panY: originY - scale * (originY - prev.panY),
          };
        }
        return { ...prev, zoom: next };
      });
    },
    [setTransform],
  );

  const rotate = useCallback(() => {
    setTransform((prev) => ({
      ...prev,
      rotation: (prev.rotation + 90) % 360,
    }));
  }, [setTransform]);

  const resetView = useCallback(() => {
    setTransform(IDENTITY);
  }, [setTransform]);

  // Global keyboard: Esc closes always; arrows cycle always; +/-/0/R only
  // fire on images (no-op on video / pdf).
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
      } else if (kind === "image") {
        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          zoomBy(ZOOM_STEP);
        } else if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          zoomBy(1 / ZOOM_STEP);
        } else if (e.key === "0") {
          e.preventDefault();
          resetView();
        } else if (e.key === "r" || e.key === "R") {
          e.preventDefault();
          rotate();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, goPrev, goNext, zoomBy, resetView, rotate, kind]);

  // Fetch the current entry's bytes and wrap them in a blob URL. Works the
  // same way for images / video / pdf — only the rendered tag changes.
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  // Natural pixel size of the current image, captured from the <img> onLoad.
  // Null for non-images and until the image decodes.
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!current) return;
    let revoked: string | null = null;
    let cancelled = false;
    setState("loading");
    setUrl(null);
    setDims(null);

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

  // Drag-to-pan — only meaningful for images, and only when zoomed in.
  const dragRef = useRef<{
    startMouseX: number;
    startMouseY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (kind !== "image") return;
      if (transformRef.current.zoom <= MIN_ZOOM) return;
      e.preventDefault();
      dragRef.current = {
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startPanX: transformRef.current.panX,
        startPanY: transformRef.current.panY,
      };
    },
    [kind],
  );

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startMouseX;
      const dy = e.clientY - d.startMouseY;
      setTransform((prev) => ({
        ...prev,
        panX: d.startPanX + dx,
        panY: d.startPanY + dy,
      }));
    };
    const handleUp = () => {
      dragRef.current = null;
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [setTransform]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (kind !== "image") return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const ox = e.clientX - (rect.left + rect.width / 2);
      const oy = e.clientY - (rect.top + rect.height / 2);
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomBy(factor, ox, oy);
    },
    [kind, zoomBy],
  );

  // Keep the active filmstrip thumbnail scrolled into view as the user cycles
  // entries (arrows, prev/next, or clicking a distant thumb).
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [index]);

  if (!current) return null;

  const isZoomed = kind === "image" && transform.zoom > MIN_ZOOM;
  const zoomPct = Math.round(transform.zoom * 100);

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="drive-preview-lightbox-title"
      portal
      size="full"
      containerClassName="fixed inset-0 z-[100] flex"
      panelClassName="relative h-full w-full flex flex-col bg-background/95 backdrop-blur-md"
      staggerChildren={false}
    >
      {/* Chrome bar */}
      <div
        className="flex items-center justify-between gap-3 px-5 py-3 border-b border-primary/10 bg-background/80"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 min-w-0">
          <div id="drive-preview-lightbox-title" className="typo-section-title truncate">{current.name}</div>
          <div className="typo-caption text-foreground font-mono truncate">
            {current.path}
          </div>
          {/* Size · pixel dimensions (images) · modified — a compact metadata
              line so the viewer answers "how big / how old / what resolution"
              without leaving for the details pane. */}
          <div className="mt-0.5 flex items-center gap-1.5 typo-caption text-foreground">
            {current.kind === "file" && (
              <span className="tabular-nums">
                {driveFormatBytes(current.size)}
              </span>
            )}
            {dims && (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">
                  {dims.w} × {dims.h}
                </span>
              </>
            )}
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              {formatRelativeTime(current.modified, t, tx)}
            </span>
          </div>
        </div>

        {/* Zoom + rotate cluster — only for images. */}
        {kind === "image" && (
          <div className="flex items-center gap-0.5 p-0.5 rounded-card bg-secondary/40 border border-primary/15">
            <ChromeIconButton
              icon={ZoomOut}
              label={t.plugins.drive.lightbox_zoom_out}
              onClick={() => zoomBy(1 / ZOOM_STEP)}
              disabled={transform.zoom <= MIN_ZOOM}
            />
            <span className="typo-caption text-foreground tabular-nums w-12 text-center select-none">
              {zoomPct}%
            </span>
            <ChromeIconButton
              icon={ZoomIn}
              label={t.plugins.drive.lightbox_zoom_in}
              onClick={() => zoomBy(ZOOM_STEP)}
              disabled={transform.zoom >= MAX_ZOOM}
            />
            <span aria-hidden className="w-px h-4 bg-primary/15 mx-0.5" />
            <ChromeIconButton
              icon={RotateCw}
              label={t.plugins.drive.lightbox_rotate}
              onClick={rotate}
            />
            <ChromeIconButton
              icon={RefreshCw}
              label={t.plugins.drive.lightbox_zoom_reset}
              onClick={resetView}
              disabled={
                transform.zoom === IDENTITY.zoom &&
                transform.rotation === IDENTITY.rotation &&
                transform.panX === 0 &&
                transform.panY === 0
              }
            />
          </div>
        )}

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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-card bg-secondary/40 border border-primary/15 hover:bg-secondary/70 hover:border-primary/25 typo-body text-foreground transition-colors focus-ring"
          aria-label={t.plugins.drive.lightbox_close}
          title={t.plugins.drive.lightbox_close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Media stage */}
      <div
        className={`relative flex-1 min-h-0 flex items-center justify-center p-8 overflow-hidden select-none ${
          isZoomed ? (dragRef.current ? "cursor-grabbing" : "cursor-grab") : ""
        }`}
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
      >
        {total > 1 && !isZoomed && (
          <button
            type="button"
            onClick={goPrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-12 h-12 rounded-full bg-secondary/50 border border-primary/15 hover:bg-cyan-500/25 hover:border-cyan-500/40 text-foreground hover:text-cyan-100 transition-colors shadow-elevation-2 focus-ring"
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
        {state === "ready" && url && kind === "image" && (
          <img
            src={url}
            alt={current.name}
            draggable={false}
            onLoad={(e) =>
              setDims({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
            style={{
              transform: `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.zoom}) rotate(${transform.rotation}deg)`,
              transition: dragRef.current
                ? "none"
                : "transform 120ms ease-out",
            }}
            className="max-w-full max-h-full object-contain rounded-card shadow-elevation-3 will-change-transform"
          />
        )}
        {state === "ready" && url && kind === "video" && (
          <video
            // key forces React to tear down and remount on entry change;
            // without this, switching between videos via prev/next would
            // keep the old element around with stale src and the controls
            // would show ⏵ on a half-loaded buffer.
            key={current.path}
            src={url}
            controls
            autoPlay
            className="max-w-full max-h-full rounded-card shadow-elevation-3 bg-black"
          />
        )}
        {state === "ready" && url && kind === "pdf" && (
          <iframe
            key={current.path}
            src={url}
            title={current.name}
            className="w-full h-full bg-secondary rounded-card shadow-elevation-3"
            // Sandbox blocks scripts/forms/popups so a malicious PDF can't
            // jump out of its frame. allow-same-origin lets the PDF
            // renderer load its assets relative to the blob URL.
            sandbox="allow-same-origin"
          />
        )}
        {state === "ready" && url && kind === "other" && (
          <div className="typo-body text-foreground italic">
            {t.plugins.drive.preview_binary}
          </div>
        )}
        {total > 1 && !isZoomed && (
          <button
            type="button"
            onClick={goNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-12 h-12 rounded-full bg-secondary/50 border border-primary/15 hover:bg-cyan-500/25 hover:border-cyan-500/40 text-foreground hover:text-cyan-100 transition-colors shadow-elevation-2 focus-ring"
            aria-label={t.plugins.drive.lightbox_next}
            title={t.plugins.drive.lightbox_next}
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>

      {/* Thumbnail filmstrip — fast visual jumping across the previewable set.
          Image tiles lazy-load (and free) their bytes as they scroll in/out of
          view so a folder of hundreds of images doesn't hold N blobs at once. */}
      {total > 1 && (
        <div
          ref={stripRef}
          className="flex items-center gap-2 px-4 py-2 border-t border-primary/10 bg-background/80 overflow-x-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {entries.map((entry, i) => (
            <FilmstripThumb
              key={entry.path}
              entry={entry}
              active={i === index}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}
    </BaseModal>
  );
}

/**
 * One filmstrip tile. Images lazy-load a thumbnail via IntersectionObserver
 * and revoke it again when scrolled out of view, so the strip stays cheap on
 * large folders; non-image kinds render their kind icon (no fetch). The
 * filename rides as the accessible label (user content — not translated).
 */
function FilmstripThumb({
  entry,
  active,
  onClick,
}: {
  entry: DriveEntry;
  active: boolean;
  onClick: () => void;
}) {
  const visual = visualForEntry(entry);
  const Icon = visual.Icon;
  const isImage = (entry.mime ?? "").startsWith("image/");
  const btnRef = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  urlRef.current = url;

  useEffect(() => {
    if (!isImage) return;
    const el = btnRef.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (records) => {
        const rec = records[0];
        if (!rec) return;
        if (rec.isIntersecting) {
          if (urlRef.current || cancelled) return;
          driveRead(entry.path)
            .then((bytes) => {
              if (cancelled) return;
              const u = URL.createObjectURL(
                new Blob([new Uint8Array(bytes)], {
                  type: entry.mime ?? "application/octet-stream",
                }),
              );
              urlRef.current = u;
              setUrl(u);
            })
            .catch(silentCatch("drive:filmstrip-thumb"));
        } else if (urlRef.current) {
          // Off-screen → free the blob to bound memory on large image sets.
          URL.revokeObjectURL(urlRef.current);
          urlRef.current = null;
          setUrl(null);
        }
      },
      { root: el.parentElement, rootMargin: "300px" },
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
  }, [entry.path, entry.mime, isImage]);

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={onClick}
      data-active={active ? "true" : undefined}
      aria-current={active}
      aria-label={entry.name}
      title={entry.name}
      className={`relative flex-shrink-0 w-14 h-14 rounded-input overflow-hidden border transition-all focus-ring ${
        active
          ? "border-cyan-400/70 ring-2 ring-cyan-400/50"
          : "border-primary/15 opacity-70 hover:opacity-100 hover:border-primary/30"
      }`}
    >
      {url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          className="w-full h-full object-cover"
        />
      ) : (
        <span
          className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${visual.gradient}`}
        >
          <Icon className={`w-5 h-5 ${visual.text}`} />
        </span>
      )}
    </button>
  );
}

function ChromeIconButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="p-1.5 rounded-input text-foreground hover:text-cyan-200 hover:bg-primary/10 disabled:opacity-35 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors focus-ring"
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}
