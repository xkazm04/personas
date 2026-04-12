import { useState, useCallback, useRef, type PointerEvent, type MouseEvent } from 'react';

interface TimelinePlayheadProps {
  currentTime: number;
  zoom: number;
  scrollX: number;
  onSeek: (time: number) => void;
}

export default function TimelinePlayhead({
  currentTime,
  zoom,
  scrollX,
  onSeek,
}: TimelinePlayheadProps) {
  const x = currentTime * zoom - scrollX;
  const [dragging, setDragging] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Click anywhere on the overlay to seek
  const handleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (dragging) return; // ignore click at end of drag
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const time = (clickX + scrollX) / zoom;
      onSeek(Math.max(0, time));
    },
    [scrollX, zoom, onSeek, dragging],
  );

  // Drag the playhead handle
  const handleHeadPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget.parentElement as HTMLElement)?.setPointerCapture(e.pointerId);
      setDragging(true);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;
      const px = e.clientX - rect.left;
      const time = (px + scrollX) / zoom;
      onSeek(Math.max(0, time));
    },
    [dragging, scrollX, zoom, onSeek],
  );

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-10 cursor-pointer"
      onClick={handleClick}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Playhead line */}
      <div
        className={`absolute top-0 bottom-0 w-0.5 pointer-events-none transition-opacity ${
          dragging ? 'bg-red-400 opacity-100' : 'bg-red-500 opacity-90'
        }`}
        style={{ left: `${x}px` }}
      >
        {/* Glow effect during drag */}
        {dragging && (
          <div
            className="absolute top-0 bottom-0 -left-1 w-3 bg-red-500/15 pointer-events-none"
          />
        )}
      </div>

      {/* Draggable playhead handle (top triangle + line) */}
      <div
        className={`absolute -left-[7px] cursor-grab active:cursor-grabbing z-20 group ${
          dragging ? 'scale-110' : ''
        }`}
        style={{ left: `${x}px`, top: '-2px' }}
        onPointerDown={handleHeadPointerDown}
      >
        {/* Triangle */}
        <svg width="14" height="10" viewBox="0 0 14 10" className="pointer-events-auto">
          <path
            d="M0 0 L14 0 L7 10 Z"
            className={`transition-colors ${
              dragging
                ? 'fill-red-400 drop-shadow-[0_0_4px_rgba(239,68,68,0.5)]'
                : 'fill-red-500 group-hover:fill-red-400'
            }`}
          />
        </svg>
      </div>
    </div>
  );
}
