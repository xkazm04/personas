// Shared canvas shell for every Mastermind variant: sea backdrop, camera,
// routes, hover focus, zoom badge, group tool, connect tool, project-open
// routing. Variants supply only the island renderer. Round 5 (Figma pass):
// edit-first — groups move/resize inline (GroupLayer owns that), the connect
// tool links projects via island taps, headers open the project sidebar.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { mix } from './ink';
import { loadGroups, saveGroups } from './groups';
import { loadLinks, saveLinks, LINK_PALETTE } from './links';
import { loadNotes, saveNotes } from './notes';
import { FleetListPopover } from './FleetListPopover';
import { GroupLayer } from './GroupLayer';
import { IslandMenu } from './IslandMenu';
import { LinkEditor } from './LinkEditor';
import { LinkLayer } from './LinkLayer';
import { NoteEditor } from './NoteEditor';
import { NoteLayer } from './NoteLayer';
import { Route } from './Route';
import { ZoomBadge } from './ZoomBadge';
import { ZoomControls } from './ZoomControls';
import { sceneBounds, zoomBand, type CanvasMode, type CanvasNote, type FleetStyle, type GroupRect, type Island, type StatsStyle, type UserLink, type VariantProps, type ZoomBand } from './types';
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
  /** Connect mode: pointer went down on an island — starts the rubber-band
   *  drag (release over another island creates the link; a plain click falls
   *  back to the tap flow). */
  onConnectStart: (slug: string, e: React.PointerEvent) => void;
  /** Double-click — frame this island (focus travel). */
  onIslandFocus: (slug: string) => void;
  /** Right-click on the header — open the dimension context menu. */
  onIslandMenu: (slug: string, e: React.MouseEvent) => void;
  /** Dimension key highlighted for THIS island (context-menu row hover). */
  highlightKey: string | null;
  /** Stats-panel treatment (prototype A/B). */
  statsStyle: StatsStyle;
  /** Multi-session terminal treatment (prototype A/B). */
  fleetStyle: FleetStyle;
  /** Badges treatment: badge clicked — open the state-filtered session list. */
  onFleetList: (slug: string, state: string, e: React.MouseEvent) => void;
}

export function CanvasShell({ scene, mode, onIslandMove, onIslandCommit, onFleetOpen, onProjectOpen, statsStyle, fleetStyle, renderIsland }: VariantProps & {
  renderIsland: (island: Island, ctx: IslandCtx) => ReactNode;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { cam, panning, fit, zoomBy, handlers } = useCanvasCamera(svgRef);
  const [hover, setHover] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupRect[]>(loadGroups);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [links, setLinks] = useState<UserLink[]>(loadLinks);
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [editingLink, setEditingLink] = useState<string | null>(null);
  const [rubber, setRubber] = useState<{ x: number; y: number } | null>(null);
  const [notes, setNotes] = useState<CanvasNote[]>(loadNotes);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ slug: string; x: number; y: number } | null>(null);
  const [highlight, setHighlight] = useState<{ slug: string; key: string } | null>(null);
  const [fleetMenu, setFleetMenu] = useState<{ slug: string; state: string; x: number; y: number } | null>(null);
  const connectDrag = useRef<{ id: number; from: string; sx: number; sy: number } | null>(null);
  const noteTap = useRef<{ id: number; sx: number; sy: number } | null>(null);
  const drawId = useRef<number | null>(null);
  const fitted = useRef(false);

  // Esc = universal cancel for the shell's overlays and half-drawn state.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setLinkSource(null);
      setEditingLink(null);
      setEditing(null);
      setRubber(null);
      setEditingNote(null);
      setMenu(null);
      setHighlight(null);
      setFleetMenu(null);
      connectDrag.current = null;
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

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
  const commitNotes = (next: CanvasNote[], persist = true) => {
    setNotes(next);
    if (persist) saveNotes(next);
  };

  /** Screen coords of a mouse event relative to the canvas container. */
  const toScreen = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onIslandMenu = (slug: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const p = toScreen(e);
    const rect = svgRef.current?.getBoundingClientRect();
    setMenu({
      slug,
      x: Math.min(p.x, (rect?.width ?? 600) - 320),
      y: Math.min(p.y, (rect?.height ?? 400) - 340),
    });
  };

  const onFleetList = (slug: string, state: string, e: React.MouseEvent) => {
    const p = toScreen(e);
    const rect = svgRef.current?.getBoundingClientRect();
    setFleetMenu({
      slug,
      state,
      x: Math.min(p.x, (rect?.width ?? 600) - 244),
      y: Math.min(p.y + 10, (rect?.height ?? 400) - 280),
    });
  };

  const createLink = (from: string, to: string) => {
    const l: UserLink = { id: `l${Date.now().toString(36)}`, from, to, label: '', dashed: false, color: LINK_PALETTE[0] };
    commitLinks([...links, l]);
    setLinkSource(null);
    setEditingLink(l.id);
  };

  // Connect tool, tap flow (fallback to the drag gesture): first tap marks the
  // source, second creates the link. Tapping the source again (or sea) cancels.
  const onIslandTap = (slug: string) => {
    if (mode !== 'connect') {
      onProjectOpen(slug);
      return;
    }
    if (!linkSource) setLinkSource(slug);
    else if (linkSource === slug) setLinkSource(null);
    else createLink(linkSource, slug);
  };

  // Connect tool, drag flow: capture on the svg so moves keep arriving while
  // the rubber band follows the cursor; release near another island links it.
  const onConnectStart = (slug: string, e: React.PointerEvent) => {
    if (mode !== 'connect' || e.button !== 0) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    connectDrag.current = { id: e.pointerId, from: slug, sx: e.clientX, sy: e.clientY };
  };

  /** Nearest island to a world point within a generous drop radius. */
  const islandAt = (p: { x: number; y: number }, exclude?: string): Island | null => {
    let best: Island | null = null;
    let bestD = 320;
    for (const i of scene.islands) {
      if (i.slug === exclude) continue;
      const d = Math.hypot(i.x - p.x, i.y - p.y);
      if (d < bestD) { best = i; bestD = d; }
    }
    return best;
  };

  const onIslandFocus = (slug: string) => {
    const i = bySlug.get(slug);
    if (i) fit({ minX: i.x - 480, maxX: i.x + 480, minY: i.y - 400, maxY: i.y + 400 });
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
    // Note mode: remember the press — a still click places a note on release
    // (pan keeps working for real drags).
    if (mode === 'note' && e.button === 0) noteTap.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY };
    if (menu) setMenu(null);
    if (fleetMenu) setFleetMenu(null);
    handlers.onPointerDown(e);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drawId.current === e.pointerId && draft) {
      const p = toWorld(e);
      setDraft({ ...draft, x1: p.x, y1: p.y });
      return;
    }
    const cd = connectDrag.current;
    if (cd && cd.id === e.pointerId) {
      if (rubber || Math.hypot(e.clientX - cd.sx, e.clientY - cd.sy) > 4) setRubber(toWorld(e));
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
    const cd = connectDrag.current;
    if (cd && cd.id === e.pointerId) {
      connectDrag.current = null;
      if (rubber) {
        const target = islandAt(rubber, cd.from);
        setRubber(null);
        if (target) createLink(cd.from, target.slug);
      } else {
        onIslandTap(cd.from);
      }
      return;
    }
    const nt = noteTap.current;
    if (nt && nt.id === e.pointerId) {
      noteTap.current = null;
      if (Math.hypot(e.clientX - nt.sx, e.clientY - nt.sy) <= 4) {
        const p = toWorld(e);
        const n: CanvasNote = { id: `n${Date.now().toString(36)}`, x: p.x, y: p.y, text: '', size: 'md', font: 'inter' };
        commitNotes([...notes, n]);
        setEditingNote(n.id);
      }
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
        style={{ touchAction: 'none', cursor: mode === 'group' || mode === 'note' ? 'crosshair' : panning ? 'grabbing' : 'grab' }}
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
              onConnectStart,
              onIslandFocus,
              onIslandMenu,
              highlightKey: highlight?.slug === i.slug ? highlight.key : null,
              statsStyle,
              fleetStyle,
              onFleetList,
            }),
          )}
          <NoteLayer notes={notes} z={cam.z} mode={mode} onNotesChange={commitNotes} onEdit={setEditingNote} />
          {/* connect overlay — ABOVE the islands so source/target/rubber are
              unmistakable (the round-5 under-island ring was barely visible) */}
          {mode === 'connect' && (
            <ConnectOverlay
              source={connectDrag.current ? bySlug.get(connectDrag.current.from) : linkSource ? bySlug.get(linkSource) : undefined}
              rubber={rubber}
              target={rubber ? islandAt(rubber, connectDrag.current?.from) : null}
              z={cam.z}
            />
          )}
        </g>
      </svg>

      <ZoomBadge z={cam.z} />
      <ZoomControls onZoomBy={zoomBy} onFit={() => fit(sceneBounds(scene.islands))} />

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

      {(() => {
        const n = editingNote ? notes.find((x) => x.id === editingNote) : null;
        if (!n) return null;
        return (
          <NoteEditor
            note={n}
            x={n.x * cam.z + cam.x}
            y={n.y * cam.z + cam.y}
            onChange={(patch) => commitNotes(notes.map((x) => (x.id === n.id ? { ...x, ...patch } : x)))}
            onDelete={() => { commitNotes(notes.filter((x) => x.id !== n.id)); setEditingNote(null); }}
            onClose={() => {
              // discard empty notes on close so misclicks don't litter the map
              if (!n.text.trim()) commitNotes(notes.filter((x) => x.id !== n.id));
              setEditingNote(null);
            }}
          />
        );
      })()}

      {menu && (() => {
        const island = bySlug.get(menu.slug);
        if (!island) return null;
        return (
          <IslandMenu
            island={island}
            x={menu.x}
            y={menu.y}
            onHoverDim={(key) => setHighlight(key ? { slug: menu.slug, key } : null)}
            onClose={() => { setMenu(null); setHighlight(null); }}
          />
        );
      })()}

      {fleetMenu && (() => {
        const island = bySlug.get(fleetMenu.slug);
        if (!island) return null;
        return (
          <FleetListPopover
            sessions={island.fleet.filter((f) => f.state === fleetMenu.state)}
            state={fleetMenu.state}
            x={fleetMenu.x}
            y={fleetMenu.y}
            onPick={onFleetOpen}
            onClose={() => setFleetMenu(null)}
          />
        );
      })()}
    </>
  );
}

const normalize = (d: { x0: number; y0: number; x1: number; y1: number }) => ({
  x: Math.min(d.x0, d.x1),
  y: Math.min(d.y0, d.y1),
  w: Math.abs(d.x1 - d.x0),
  h: Math.abs(d.y1 - d.y0),
});

/** Connect-mode feedback: bright counter-scaled ring on the source, a dashed
 *  rubber line to the cursor, and a success-tinted ring on the drop target. */
function ConnectOverlay({ source, rubber, target, z }: {
  source: Island | undefined;
  rubber: { x: number; y: number } | null;
  target: Island | null;
  z: number;
}) {
  const k = 1 / z;
  const ring = (i: Island, color: string, r: number) => (
    <g transform={`translate(${i.x} ${i.y}) scale(${k})`}>
      <circle r={r} fill="none" stroke={color} strokeWidth={3} strokeDasharray="10 7" opacity={0.95} />
      <circle r={r + 7} fill="none" stroke={color} strokeWidth={1} opacity={0.4} />
    </g>
  );
  return (
    <g pointerEvents="none">
      {source && rubber && (
        <line
          x1={source.x} y1={source.y} x2={rubber.x} y2={rubber.y}
          stroke="var(--primary)" strokeWidth={2.5} strokeDasharray="10 8"
          strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.9}
        />
      )}
      {source && ring(source, 'var(--primary)', 42)}
      {target && ring(target, 'var(--status-success)', 48)}
    </g>
  );
}
