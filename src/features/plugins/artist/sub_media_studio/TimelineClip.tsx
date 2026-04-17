import { useState, useCallback, useRef, type PointerEvent, type ReactNode } from 'react';
import { formatRulerTime } from '../utils/format';

/**
 * TimelineClip — shared draggable + trimmable clip wrapper for all lane types.
 *
 * Features:
 * - Click to select
 * - Drag the body to reposition on the timeline (changes startTime)
 * - Drag left edge to trim start
 * - Drag right edge to trim end
 * - Snap to 0.25s grid during drag
 * - Hover tooltip with time range
 * - Right-click context menu callback
 */

const SNAP_SECONDS = 0.25;

function snap(val: number): number {
  return Math.round(val / SNAP_SECONDS) * SNAP_SECONDS;
}

interface TimelineClipProps {
  id: string;
  startTime: number;
  duration: number;
  zoom: number;
  scrollX: number;
  isSelected: boolean;
  /** Minimum allowed duration after trim (seconds) */
  minDuration?: number;
  /** CSS classes for the clip body */
  className: string;
  /** CSS classes for selected state */
  selectedClassName: string;
  onClick: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (x: number, y: number) => void;
  /** Called during/after drag-to-move */
  onMove: (newStartTime: number) => void;
  /** Called during/after trim-left (changes startTime AND duration) */
  onTrimLeft?: (deltaSeconds: number) => void;
  /** Called during/after trim-right (changes duration) */
  onTrimRight?: (deltaSeconds: number) => void;
  children: ReactNode;
}

type DragMode = 'move' | 'trim-left' | 'trim-right' | null;

export default function TimelineClip({
  id: _id,
  startTime,
  duration,
  zoom,
  scrollX,
  isSelected,
  minDuration = 0.25,
  className,
  selectedClassName,
  onClick,
  onDoubleClick,
  onContextMenu,
  onMove,
  onTrimLeft,
  onTrimRight,
  children,
}: TimelineClipProps) {
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const dragStartRef = useRef<{ pointerX: number; originalStart: number; originalDuration: number }>({
    pointerX: 0,
    originalStart: 0,
    originalDuration: 0,
  });
  const clipRef = useRef<HTMLDivElement>(null);

  const left = startTime * zoom - scrollX;
  const width = Math.max(duration * zoom, 24);

  // -- Pointer handlers -------------------------------------------------------

  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>, mode: DragMode) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDragMode(mode);
      dragStartRef.current = {
        pointerX: e.clientX,
        originalStart: startTime,
        originalDuration: duration,
      };
    },
    [startTime, duration],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!dragMode) return;
      const deltaPixels = e.clientX - dragStartRef.current.pointerX;
      const deltaSeconds = deltaPixels / zoom;

      if (dragMode === 'move') {
        const newStart = snap(Math.max(0, dragStartRef.current.originalStart + deltaSeconds));
        onMove(newStart);
      } else if (dragMode === 'trim-left' && onTrimLeft) {
        const maxTrim = dragStartRef.current.originalDuration - minDuration;
        const trimDelta = snap(Math.max(-dragStartRef.current.originalStart, Math.min(maxTrim, deltaSeconds)));
        onTrimLeft(trimDelta);
      } else if (dragMode === 'trim-right' && onTrimRight) {
        const minTrimDelta = -(dragStartRef.current.originalDuration - minDuration);
        const trimDelta = snap(Math.max(minTrimDelta, deltaSeconds));
        onTrimRight(trimDelta);
      }
    },
    [dragMode, zoom, minDuration, onMove, onTrimLeft, onTrimRight],
  );

  const handlePointerUp = useCallback(() => {
    setDragMode(null);
  }, []);

  const isDragging = dragMode !== null;

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!onContextMenu) return;
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e.clientX, e.clientY);
    },
    [onContextMenu],
  );

  const tooltipText = `${formatRulerTime(startTime)} — ${formatRulerTime(startTime + duration)}`;

  return (
    <div
      ref={clipRef}
      className={`absolute group transition-shadow ${
        isSelected ? selectedClassName : className
      } ${isDragging ? 'z-20 shadow-lg' : 'z-10'}`}
      style={{ left: `${left}px`, width: `${width}px` }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onDoubleClick={onDoubleClick}
      onContextMenu={handleContextMenu}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      title={tooltipText}
    >
      {/* Hover time badge — visible on hover, hidden during drag */}
      {!isDragging && (
        <div className="absolute -top-5 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-40">
          <span className="px-1.5 py-0.5 rounded text-md font-mono bg-black/80 text-white/80 whitespace-nowrap tabular-nums">
            {tooltipText}
          </span>
        </div>
      )}
      {/* Left trim handle */}
      {onTrimLeft && (
        <div
          className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-30 group/trim-l"
          onPointerDown={(e) => handlePointerDown(e, 'trim-left')}
        >
          <div className={`absolute left-0 top-1 bottom-1 w-1 rounded-full transition-colors ${
            dragMode === 'trim-left' ? 'bg-white/80' : 'bg-white/0 group-hover/trim-l:bg-white/40'
          }`} />
        </div>
      )}

      {/* Body (drag to move) */}
      <div
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        style={{ left: onTrimLeft ? '8px' : '0', right: onTrimRight ? '8px' : '0' }}
        onPointerDown={(e) => handlePointerDown(e, 'move')}
      >
        {children}
      </div>

      {/* Right trim handle */}
      {onTrimRight && (
        <div
          className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-30 group/trim-r"
          onPointerDown={(e) => handlePointerDown(e, 'trim-right')}
        >
          <div className={`absolute right-0 top-1 bottom-1 w-1 rounded-full transition-colors ${
            dragMode === 'trim-right' ? 'bg-white/80' : 'bg-white/0 group-hover/trim-r:bg-white/40'
          }`} />
        </div>
      )}
    </div>
  );
}
