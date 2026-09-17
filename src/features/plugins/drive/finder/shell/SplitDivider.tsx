import { useCallback, useRef, useState } from "react";

import {
  PANE_LIMITS,
  clampPaneWidth,
  dragPaneWidth,
  keyPaneWidth,
  type PaneSide,
} from "./splitPaneMath";

interface Props {
  side: PaneSide;
  width: number;
  label: string;
  /** Live width during a drag (parent renders it), committed on release. */
  onPreview: (w: number | null) => void;
  onCommit: (w: number) => void;
}

/**
 * 6px draggable + keyboard-resizable divider. Pointer capture keeps the drag
 * alive when the cursor leaves the strip; double-click resets to the default.
 */
export function SplitDivider({ side, width, label, onPreview, onCommit }: Props) {
  const startRef = useRef<{ x: number; w: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      startRef.current = { x: e.clientX, w: width };
      setDragging(true);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = startRef.current;
      if (!start) return;
      onPreview(dragPaneWidth(side, start.w, start.x, e.clientX));
    },
    [side, onPreview],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = startRef.current;
      if (!start) return;
      startRef.current = null;
      setDragging(false);
      e.currentTarget.releasePointerCapture(e.pointerId);
      onPreview(null);
      onCommit(dragPaneWidth(side, start.w, start.x, e.clientX));
    },
    [side, onPreview, onCommit],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Home") {
        e.preventDefault();
        onCommit(PANE_LIMITS[side].def);
        return;
      }
      const next = keyPaneWidth(side, width, e.key);
      if (next === null) return;
      e.preventDefault();
      onCommit(next);
    },
    [side, width, onCommit],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={PANE_LIMITS[side].min}
      aria-valuemax={PANE_LIMITS[side].max}
      aria-valuenow={clampPaneWidth(side, width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onCommit(PANE_LIMITS[side].def)}
      onKeyDown={onKeyDown}
      className={`group relative w-1.5 flex-shrink-0 cursor-col-resize select-none touch-none focus-ring rounded-interactive transition-colors duration-fast ${
        dragging ? "bg-primary/40" : "bg-transparent hover:bg-primary/25"
      }`}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover:bg-primary/40"
      />
    </div>
  );
}
