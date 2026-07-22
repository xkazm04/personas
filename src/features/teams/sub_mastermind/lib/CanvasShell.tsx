// Shared canvas shell for every Mastermind variant (hoisted in round 3): sea
// backdrop, camera, routes, hover focus, zoom badge, and the group-draw tool.
// Variants supply only the island renderer — the "differently shaped thing on
// the same sea" contract.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { mix } from './ink';
import { loadGroups, saveGroups } from './groups';
import { GroupLayer } from './GroupLayer';
import { Route } from './Route';
import { ZoomBadge } from './ZoomBadge';
import { sceneBounds, zoomBand, type CanvasMode, type GroupRect, type Island, type VariantProps, type ZoomBand } from './types';
import { useCanvasCamera } from './useCanvasCamera';

const COPY = { labelPlaceholder: 'Group label…', defaultLabel: 'Group' };
const MIN_GROUP_SIZE = 60; // world px — smaller drags are treated as clicks

export interface IslandCtx {
  z: number;
  band: ZoomBand;
  mode: CanvasMode;
  dimmed: boolean;
  onHover: (slug: string | null) => void;
  onIslandMove: (slug: string, x: number, y: number) => void;
  onIslandCommit: (slug: string, x: number, y: number) => void;
  onFleetOpen: (sessionId: string) => void;
}

export function CanvasShell({ scene, mode, onIslandMove, onIslandCommit, onFleetOpen, renderIsland }: VariantProps & {
  renderIsland: (island: Island, ctx: IslandCtx) => ReactNode;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { cam, panning, fit, handlers } = useCanvasCamera(svgRef);
  const [hover, setHover] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupRect[]>(loadGroups);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const drawId = useRef<number | null>(null);
  const fitted = useRef(false);

  useLayoutEffect(() => {
    if (!fitted.current && scene.islands.length > 0) {
      fit(sceneBounds(scene.islands));
      fitted.current = true;
    }
  }, [scene.islands, fit]);

  const band = zoomBand(cam.z);
  const bySlug = useMemo(() => new Map(scene.islands.map((i) => [i.slug, i])), [scene.islands]);
  const lit = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    for (const e of scene.edges) {
      if (e.from === hover) s.add(e.to);
      if (e.to === hover) s.add(e.from);
    }
    return s;
  }, [hover, scene.edges]);

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left - cam.x) / cam.z, y: (e.clientY - rect.top - cam.y) / cam.z };
  };

  const commitGroups = (next: GroupRect[]) => {
    setGroups(next);
    saveGroups(next);
  };

  // Group mode: left-drag draws; middle-drag still pans (forwarded to camera).
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (mode === 'group' && e.button === 0) {
      const p = toWorld(e);
      drawId.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }
    handlers.onPointerDown(e);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drawId.current === e.pointerId && draft) {
      const p = toWorld(e);
      setDraft({ ...draft, x1: p.x, y1: p.y });
      return;
    }
    handlers.onPointerMove(e);
  };
  const onPointerEnd = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drawId.current === e.pointerId) {
      drawId.current = null;
      if (draft) {
        const r = normalize(draft);
        setDraft(null);
        if (r.w >= MIN_GROUP_SIZE && r.h >= MIN_GROUP_SIZE) {
          const g: GroupRect = { id: `g${Date.now().toString(36)}`, label: COPY.defaultLabel, ...r };
          commitGroups([...groups, g]);
          setEditing(g.id);
        }
      }
      return;
    }
    handlers.onPointerUp(e);
  };

  const editingGroup = editing ? groups.find((g) => g.id === editing) ?? null : null;

  return (
    <>
      <svg
        ref={svgRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDoubleClick={handlers.onDoubleClick}
        data-testid="mastermind-canvas"
        className="absolute inset-0 w-full h-full select-none"
        style={{ touchAction: 'none', cursor: mode === 'group' ? 'crosshair' : panning ? 'grabbing' : 'grab' }}
      >
        <defs>
          <radialGradient id="mm-sea" cx="32%" cy="22%" r="95%">
            <stop offset="0%" stopColor={mix('var(--primary)', 7, 'var(--background)')} />
            <stop offset="55%" stopColor="var(--background)" />
            <stop offset="100%" stopColor={mix('var(--secondary)', 45, 'var(--background)')} />
          </radialGradient>
          <filter id="mm-coast" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>

        <rect width="100%" height="100%" fill="url(#mm-sea)" />

        <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.z})`}>
          <GroupLayer
            groups={groups}
            draft={draft ? normalize(draft) : null}
            z={cam.z}
            interactive={mode === 'group'}
            onRename={setEditing}
            onDelete={(id) => commitGroups(groups.filter((g) => g.id !== id))}
          />
          {scene.edges.map((e) => (
            <Route key={`${e.from}→${e.to}`} e={e} a={bySlug.get(e.from)} b={bySlug.get(e.to)} lit={hover === e.from || hover === e.to} />
          ))}
          {scene.islands.map((i) =>
            renderIsland(i, {
              z: cam.z,
              band,
              mode,
              dimmed: lit !== null && !lit.has(i.slug),
              onHover: setHover,
              onIslandMove,
              onIslandCommit,
              onFleetOpen,
            }),
          )}
        </g>
      </svg>

      <ZoomBadge z={cam.z} />

      {/* inline label editor for the group being named/renamed */}
      {editingGroup && (
        <input
          key={editingGroup.id}
          autoFocus
          defaultValue={editingGroup.label}
          placeholder={COPY.labelPlaceholder}
          className="absolute z-20 px-2 py-1 typo-caption rounded-input bg-secondary border border-primary/40 text-foreground outline-none w-44"
          style={{ left: editingGroup.x * cam.z + cam.x + 4, top: editingGroup.y * cam.z + cam.y - 34 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(null);
          }}
          onBlur={(e) => {
            const label = e.target.value.trim() || COPY.defaultLabel;
            commitGroups(groups.map((g) => (g.id === editingGroup.id ? { ...g, label } : g)));
            setEditing(null);
          }}
          data-testid="mm-group-label-input"
        />
      )}
    </>
  );
}

const normalize = (d: { x0: number; y0: number; x1: number; y1: number }) => ({
  x: Math.min(d.x0, d.x1),
  y: Math.min(d.y0, d.y1),
  w: Math.abs(d.x1 - d.x0),
  h: Math.abs(d.y1 - d.y0),
});
