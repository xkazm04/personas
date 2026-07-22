// Shared canvas shell for every Mastermind variant: sea backdrop, camera,
// routes, hover focus, zoom badge, group tool, connect tool, project-open
// routing. Variants supply only the island renderer. Round 5 (Figma pass):
// edit-first — groups move/resize inline (GroupLayer owns that), the connect
// tool links projects via island taps, headers open the project sidebar.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { mix } from './ink';
import { loadGroups, saveGroups } from './groups';
import { loadLinks, saveLinks, LINK_PALETTE } from './links';
import { GroupLayer } from './GroupLayer';
import { LinkEditor } from './LinkEditor';
import { LinkLayer } from './LinkLayer';
import { Route } from './Route';
import { ZoomBadge } from './ZoomBadge';
import { sceneBounds, zoomBand, type CanvasMode, type GroupRect, type Island, type UserLink, type VariantProps, type ZoomBand } from './types';
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
  /** Island tapped (header click in edit, any click in connect) — the shell
   *  routes it: connect endpoint vs project sidebar. */
  onIslandTap: (slug: string) => void;
}

export function CanvasShell({ scene, mode, onIslandMove, onIslandCommit, onFleetOpen, onProjectOpen, renderIsland }: VariantProps & {
  renderIsland: (island: Island, ctx: IslandCtx) => ReactNode;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { cam, panning, fit, handlers } = useCanvasCamera(svgRef);
  const [hover, setHover] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupRect[]>(loadGroups);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [links, setLinks] = useState<UserLink[]>(loadLinks);
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [editingLink, setEditingLink] = useState<string | null>(null);
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

  const commitGroups = (next: GroupRect[], persist = true) => {
    setGroups(next);
    if (persist) saveGroups(next);
  };
  const commitLinks = (next: UserLink[]) => {
    setLinks(next);
    saveLinks(next);
  };

  // Connect tool: first tap marks the source, second creates the link and
  // opens its editor. Tapping the source again (or the sea) cancels.
  const onIslandTap = (slug: string) => {
    if (mode !== 'connect') {
      onProjectOpen(slug);
      return;
    }
    if (!linkSource) {
      setLinkSource(slug);
      return;
    }
    if (linkSource === slug) {
      setLinkSource(null);
      return;
    }
    const l: UserLink = { id: `l${Date.now().toString(36)}`, from: linkSource, to: slug, label: '', dashed: false, color: LINK_PALETTE[0] };
    commitLinks([...links, l]);
    setLinkSource(null);
    setEditingLink(l.id);
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
    if (mode === 'connect' && e.button === 0) setLinkSource(null);
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
  const editingLinkObj = editingLink ? links.find((l) => l.id === editingLink) ?? null : null;
  const editorAnchor = useMemo(() => {
    if (!editingLinkObj) return null;
    const a = bySlug.get(editingLinkObj.from);
    const b = bySlug.get(editingLinkObj.to);
    if (!a || !b) return null;
    return { x: ((a.x + b.x) / 2) * cam.z + cam.x, y: ((a.y + b.y) / 2) * cam.z + cam.y };
  }, [editingLinkObj, bySlug, cam]);

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
            mode={mode}
            islands={scene.islands}
            onGroupsChange={commitGroups}
            onIslandMove={onIslandMove}
            onIslandCommit={onIslandCommit}
            onRename={setEditing}
            onDelete={(id) => commitGroups(groups.filter((g) => g.id !== id))}
          />
          {scene.edges.map((e) => (
            <Route key={`${e.from}→${e.to}`} e={e} a={bySlug.get(e.from)} b={bySlug.get(e.to)} lit={hover === e.from || hover === e.to} />
          ))}
          <LinkLayer
            links={links}
            bySlug={bySlug}
            z={cam.z}
            clickable={mode === 'edit' || mode === 'connect'}
            sourceSlug={mode === 'connect' ? linkSource : null}
            onEdit={setEditingLink}
          />
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
              onIslandTap,
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

      {editingLinkObj && editorAnchor && (
        <LinkEditor
          link={editingLinkObj}
          x={editorAnchor.x}
          y={editorAnchor.y}
          onChange={(patch) => commitLinks(links.map((l) => (l.id === editingLinkObj.id ? { ...l, ...patch } : l)))}
          onDelete={() => { commitLinks(links.filter((l) => l.id !== editingLinkObj.id)); setEditingLink(null); }}
          onClose={() => setEditingLink(null)}
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
