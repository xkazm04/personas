import { useState, useEffect, useRef } from 'react';

// ============================================================================
// Popover Positioner (viewport-clamped near click)
// ============================================================================

const POPOVER_WIDTH = 320;
const POPOVER_OFFSET = 16;

export default function PopoverPositioner({
  canvasRef,
  pos,
  children,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  pos: { x: number; y: number };
  children: React.ReactNode;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ opacity: 0, position: 'absolute' });
  const [pointerSide, setPointerSide] = useState<'left' | 'right'>('left');

  useEffect(() => {
    const canvas = canvasRef.current;
    const popover = popoverRef.current;
    if (!canvas || !popover) return;

    const canvasW = canvas.scrollWidth;
    const popoverH = popover.offsetHeight;

    // Try placing to the right of the click point
    let left = pos.x + POPOVER_OFFSET;
    let side: 'left' | 'right' = 'left';

    // If it overflows right, place to the left
    if (left + POPOVER_WIDTH > canvasW - 8) {
      left = pos.x - POPOVER_WIDTH - POPOVER_OFFSET;
      side = 'right';
    }
    // Clamp left
    left = Math.max(8, left);

    // Vertical: center on click point, clamp within canvas
    let top = pos.y - popoverH / 2;
    top = Math.max(8, top);

    setStyle({ position: 'absolute', left, top, width: POPOVER_WIDTH, zIndex: 10 });
    setPointerSide(side);
  }, [canvasRef, pos]);

  return (
    <div ref={popoverRef} style={style}>
      {children}
      {/* Triangle pointer */}
      <div
        className="absolute top-1/2 -translate-y-1/2"
        style={pointerSide === 'left'
          ? { left: -6 }
          : { right: -6 }
        }
      >
        <div
          className="w-3 h-3 bg-background/95 border border-primary/20 rotate-45"
          style={pointerSide === 'left'
            ? { borderRight: 'none', borderTop: 'none' }
            : { borderLeft: 'none', borderBottom: 'none' }
          }
        />
      </div>
    </div>
  );
}
