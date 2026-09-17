import { useCallback, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { BaseModal } from "@/features/shared/components/modals";
import { Button } from "@/features/shared/components/buttons";
import { ErrorBoundary } from "@/features/shared/components/feedback/ErrorBoundary";
import { useTranslation } from "@/i18n/useTranslation";
import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from "@/lib/keyboard/AppKeyboardProvider";
import type { QuickLookProps } from "../types";
import { QuickLookMedia } from "./QuickLookMedia";
import { QuickLookStrip } from "./QuickLookStrip";
import { QuickLookToolbar } from "./QuickLookToolbar";
import { useEntryMedia } from "./useEntryMedia";
import { MIN_ZOOM, useQuickLookTransform, ZOOM_STEP } from "./useQuickLookTransform";

const TITLE_ID = "drive-finder-quicklook-title";

/**
 * Finder Quick Look — a full overlay over `BaseModal` (which owns Escape,
 * the focus trap and the reduced-motion panel variants). Arrows step through
 * `entries`; +/-/0/R only fire on images; zoom anchors at the wheel origin.
 */
/** Just under BaseModal's OVERLAY_DISMISS rung so Escape stays the modal's; above the route. */
const QUICK_LOOK_KEYBOARD_PRIORITY = OVERLAY_DISMISS_PRIORITY - 5;

export function QuickLook({ entries, initialPath, onClose, onStep, onOpenInOs }: QuickLookProps) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  const [index, setIndex] = useState(() =>
    Math.max(0, entries.findIndex((e) => e.path === initialPath)),
  );
  const total = entries.length;
  const current = entries[index] ?? null;
  const media = useEntryMedia(current);
  const isImage = media.kind === "image";
  const { transform, zoomBy, rotate, reset, pan } = useQuickLookTransform(current?.path ?? "");

  const goTo = useCallback(
    (next: number) => {
      if (total === 0) return;
      const i = ((next % total) + total) % total;
      setIndex(i);
      const entry = entries[i];
      if (entry) onStep?.(entry.path);
    },
    [entries, total, onStep],
  );
  const goPrev = useCallback(() => goTo(index - 1), [goTo, index]);
  const goNext = useCallback(() => goTo(index + 1), [goTo, index]);

  // Just under BaseModal's rung so Escape stays its own; above the route.
  useAppKeyboard(
    (e) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
      else if (!isImage) return false;
      else if (e.key === "+" || e.key === "=") zoomBy(ZOOM_STEP);
      else if (e.key === "-" || e.key === "_") zoomBy(1 / ZOOM_STEP);
      else if (e.key === "0") reset();
      else if (e.key === "r" || e.key === "R") rotate();
      else return false;
      e.preventDefault();
      return true;
    },
    { priority: QUICK_LOOK_KEYBOARD_PRIORITY },
  );

  // Drag-to-pan, only on a zoomed image. Pointer capture keeps the gesture
  // on the element that owns it: the browser ends the subscription on
  // pointerup / pointercancel / lostpointercapture, so nothing outlives an
  // interrupted drag.
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isImage || transform.zoom <= MIN_ZOOM || e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { x: e.clientX, y: e.clientY, panX: transform.panX, panY: transform.panY };
      setDragging(true);
    },
    [isImage, transform],
  );
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (d) pan(d.panX + e.clientX - d.x, d.panY + e.clientY - d.y);
    },
    [pan],
  );
  const endDrag = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!isImage) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ox = e.clientX - (rect.left + rect.width / 2);
      const oy = e.clientY - (rect.top + rect.height / 2);
      zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, ox, oy);
    },
    [isImage, zoomBy],
  );

  if (!current) return null;
  const isZoomed = isImage && transform.zoom > MIN_ZOOM;
  const cursor = isZoomed ? (dragging ? "cursor-grabbing" : "cursor-grab") : "";

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId={TITLE_ID}
      portal
      size="full"
      containerClassName="fixed inset-0 z-[100] flex p-4"
      panelClassName="relative flex-1 min-w-0 flex flex-col glass-lg rounded-modal overflow-hidden shadow-elevation-4"
      staggerChildren={false}
    >
      <div data-testid="finder-quicklook" className="flex flex-col h-full min-h-0">
        <QuickLookToolbar
          title={current.name}
          titleId={TITLE_ID}
          index={index}
          total={total}
          isImage={isImage}
          transform={transform}
          onZoomIn={() => zoomBy(ZOOM_STEP)}
          onZoomOut={() => zoomBy(1 / ZOOM_STEP)}
          onRotate={rotate}
          onReset={reset}
          onOpenInOs={() => onOpenInOs(current)}
          onClose={onClose}
        />

        <div
          className={`relative flex-1 min-h-0 flex items-center justify-center p-6 overflow-hidden select-none ${cursor}`}
          onClick={(e) => e.stopPropagation()}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        >
          {total > 1 && !isZoomed && (
            <Button
              variant="secondary"
              size="icon-md"
              icon={<ChevronLeft className="w-5 h-5" />}
              aria-label={f.ql_prev}
              title={f.ql_prev}
              onClick={goPrev}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-10 rounded-full shadow-elevation-2"
            />
          )}
          <ErrorBoundary key={current.path} name={f.ql_title}>
            <QuickLookMedia entry={current} media={media} transform={transform} dragging={dragging} />
          </ErrorBoundary>
          {total > 1 && !isZoomed && (
            <Button
              variant="secondary"
              size="icon-md"
              icon={<ChevronRight className="w-5 h-5" />}
              aria-label={f.ql_next}
              title={f.ql_next}
              onClick={goNext}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-10 rounded-full shadow-elevation-2"
            />
          )}
        </div>

        <QuickLookStrip entries={entries} index={index} onSelect={goTo} />
      </div>
    </BaseModal>
  );
}
