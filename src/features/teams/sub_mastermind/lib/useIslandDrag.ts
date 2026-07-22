// Edit-mode island dragging. Attached to each island <g>: pointer-captures the
// island, converts screen deltas to world deltas via the camera zoom, and
// stops propagation so the canvas pan never fights the drag. In view mode it
// returns inert handlers (hooks stay unconditional for rules-of-hooks).
import { useRef } from 'react';

export interface IslandDragHandlers {
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerCancel: (e: React.PointerEvent<SVGGElement>) => void;
}

export function useIslandDrag({ enabled, z, slug, x, y, onMove, onCommit }: {
  enabled: boolean;
  z: number;
  slug: string;
  x: number;
  y: number;
  onMove: (slug: string, x: number, y: number) => void;
  onCommit: (slug: string, x: number, y: number) => void;
}): IslandDragHandlers {
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; z: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<SVGGElement>) => {
    if (!enabled || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: x, oy: y, z };
  };

  const at = (d: NonNullable<typeof drag.current>, e: React.PointerEvent) => ({
    x: d.ox + (e.clientX - d.sx) / d.z,
    y: d.oy + (e.clientY - d.sy) / d.z,
  });

  const onPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const p = at(d, e);
    onMove(slug, p.x, p.y);
  };

  const end = (e: React.PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const p = at(d, e);
    onCommit(slug, p.x, p.y);
  };

  return { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end };
}
