// Island header dragging (edit mode) — RENDER-FREE (optimizer pass): the
// island's root <g> transform is written imperatively during the drag, exactly
// like the camera's pan path, and React state is committed exactly ONCE on
// release (onCommit → position override + persist). Dragging one island no
// longer re-renders the world. Attached to the island's BANNER — the header is
// the move handle (Figma-like); the body stays free for cell interactions and
// panning. Under 4px of travel on release fires onSelect (opens the project
// sidebar) instead of a commit. Edges and group rectangles attached to the
// island catch up at commit — the same trade the render-free pan made.
// Inert when disabled (hooks stay unconditional).
import { useLayoutEffect, useRef, type RefObject } from 'react';

export interface IslandDragHandlers {
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerCancel: (e: React.PointerEvent<SVGGElement>) => void;
}

export function useIslandDrag({ enabled, z, slug, x, y, rootRef, onCommit, onSelect }: {
  enabled: boolean;
  z: number;
  slug: string;
  x: number;
  y: number;
  /** The island's root <g> — its transform is driven directly mid-drag. */
  rootRef: RefObject<SVGGElement | null>;
  onCommit: (slug: string, x: number, y: number) => void;
  /** Fired when the pointer released without meaningful travel (a click). */
  onSelect?: (slug: string) => void;
}): IslandDragHandlers {
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; z: number; moved: boolean; lx: number; ly: number } | null>(null);

  // If unrelated state (a fleet tick, hover) re-renders the island mid-drag,
  // React reconciles the root transform back to the stale committed position —
  // re-assert the live one (mirrors useCanvasCamera's pan guard).
  useLayoutEffect(() => {
    const d = drag.current;
    if (d?.moved) rootRef.current?.setAttribute('transform', `translate(${d.lx} ${d.ly})`);
  });

  const onPointerDown = (e: React.PointerEvent<SVGGElement>) => {
    if (!enabled || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: x, oy: y, z, moved: false, lx: x, ly: y };
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
      d.lx = p.x;
      d.ly = p.y;
      rootRef.current?.setAttribute('transform', `translate(${p.x} ${p.y})`);
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
