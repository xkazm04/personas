// Island header dragging (edit mode). Attached to the island's BANNER — the
// header is the move handle (Figma-like); the body below stays free for cell
// interactions and canvas panning. Distinguishes click from drag: under 4px of
// travel on release fires onSelect (opens the project sidebar) instead of a
// position commit. Inert when disabled (hooks stay unconditional).
import { useRef } from 'react';

export interface IslandDragHandlers {
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerCancel: (e: React.PointerEvent<SVGGElement>) => void;
}

export function useIslandDrag({ enabled, z, slug, x, y, onMove, onCommit, onSelect }: {
  enabled: boolean;
  z: number;
  slug: string;
  x: number;
  y: number;
  onMove: (slug: string, x: number, y: number) => void;
  onCommit: (slug: string, x: number, y: number) => void;
  /** Fired when the pointer released without meaningful travel (a click). */
  onSelect?: (slug: string) => void;
}): IslandDragHandlers {
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; z: number; moved: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent<SVGGElement>) => {
    if (!enabled || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: x, oy: y, z, moved: false };
  };

  const at = (d: NonNullable<typeof drag.current>, e: React.PointerEvent) => ({
    x: d.ox + (e.clientX - d.sx) / d.z,
    y: d.oy + (e.clientY - d.sy) / d.z,
  });

  const onPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
    if (d.moved) {
      const p = at(d, e);
      onMove(slug, p.x, p.y);
    }
  };

  const end = (e: React.PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.moved) {
      const p = at(d, e);
      onCommit(slug, p.x, p.y);
    } else {
      onSelect?.(slug);
    }
  };

  return { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end };
}
