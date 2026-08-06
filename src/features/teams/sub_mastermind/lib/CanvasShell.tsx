// Shared canvas shell for every Mastermind variant: sea backdrop, camera,
// routes, hover focus, zoom badge, group tool, connect tool, project-open
// routing. Variants supply only the island renderer. Round 5 (Figma pass):
// edit-first — groups move/resize inline (GroupLayer owns that), the connect
// tool links projects via island taps, headers open the project sidebar.
//
// Round 14 (render-free navigation): the world <g> is driven imperatively while
// panning (see useCanvasCamera), islands are React.memo'd with referentially
// stable callbacks, and islands whose centre falls outside the viewport (plus a
// generous margin) are culled from the render. Together these keep a 50–100
// project portfolio at 60fps — a pan does zero island re-renders and a wheel
// zoom commits at most once per animation frame.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { mix, STATE_INK } from './ink';
import { saveGroups } from './groups';
import { saveLinks, LINK_PALETTE } from './links';
import { saveNotes } from './notes';
import { loadPositions } from './positions';
import { canvasId } from './canvasIds';
import { revertAthenaObjects } from './layoutStore';
import { useAthenaObjectCount, useLayoutGroups, useLayoutLinks, useLayoutNotes } from './useLayout';
import { AthenaRevertControl } from './AthenaRevertControl';
import { useCanvasFocus } from './focusStore';
import { nearestTo, pickInDirection } from './kbNav';
import { tidyLayout, type TidyResult } from './tidyLayout';
import { DimLegend } from './DimLegend';
import { FleetListPopover } from './FleetListPopover';
import { GroupLayer, type GroupMember } from './GroupLayer';
import { IslandMenu } from './IslandMenu';
import { LinkEditor } from './LinkEditor';
import { LinkLayer } from './LinkLayer';
import { NoteEditor } from './NoteEditor';
import { NoteLayer } from './NoteLayer';
import { Route } from './Route';
import { useEventCallback } from './useEventCallback';
import { ZoomBadge } from './ZoomBadge';
import { ZoomControls } from './ZoomControls';
import { bandGte, sceneBounds, zoomBand, type CanvasMode, type CanvasNote, type DimNode, type GroupRect, type Island, type UserLink, type VariantProps, type ZoomBand } from './types';
import { MAX_Z, MIN_Z, useCanvasCamera } from './useCanvasCamera';
import { categoryNodes, type CategoryNode } from './dimCategories';
import {
  DIM_OPEN_MIN_BAND,
  bandTargetZ,
  dimReadPayload,
  islandReadPayload,
  takeCanvasActions,
  useCanvasActionVersion,
  type CanvasActionFailReason,
  type CanvasActionRequest,
  type CanvasActionResult,
  type CanvasCameraReadout,
} from './canvasActionStore';
import { useCanvasTestBridge } from './canvasTestBridge';


const MIN_GROUP_SIZE = 60; // world px — smaller drags are treated as clicks
// Half an island footprint (~900×800 world units) plus slack, so an island is
// only culled once its whole body is well clear of the viewport — no popping.
const CULL_MARGIN = 700;
// Islands committed per animation frame on first mount (see mountBudget). The
// wave ADAPTS instead of being a constant: one island is ~150 SVG nodes, and
// how many of those fit in a frame is a property of the machine, not of the
// canvas — a fixed 5 either stalls a busy laptop or wastes frames on a
// workstation. Each wave is timed and the next one is sized from the result.
const MOUNT_WAVE_START = 4;
const MOUNT_WAVE_MIN = 1;
const MOUNT_WAVE_MAX = 14;
/** Commit time above which the previous wave is judged too big (~1.5 frames). */
const MOUNT_FRAME_BUDGET_MS = 24;

export interface IslandCtx {
  z: number;
  band: ZoomBand;
  mode: CanvasMode;
  onHover: (slug: string | null) => void;
  onIslandCommit: (slug: string, x: number, y: number) => void;
  onFleetOpen: (sessionId: string) => void;
  /** Island tapped (header click in edit, any click in connect) — the shell
   *  routes it: connect endpoint vs project sidebar. */
  onIslandTap: (slug: string) => void;
  /** Banner Ship chip clicked — deep-link into the project's Factory Ship tab. */
  onShipOpen: (slug: string) => void;
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
  /** Fleet badge clicked — open the state-filtered session list. */
  onFleetList: (slug: string, state: string, e: React.MouseEvent) => void;
  /** Actionable dimension cell clicked — page opens its Improve popover. */
  onDimOpen: (slug: string, node: DimNode, e: React.MouseEvent) => void;
  /** In-progress-personas badge clicked — page opens the persona list. */
  onPersonasOpen: (slug: string, e: React.MouseEvent) => void;
  /** Collapsed category cell clicked — page opens its dimension list. */
  onCategoryOpen: (slug: string, category: CategoryNode, e: React.MouseEvent) => void;
}

export function CanvasShell({ scene, mode, onIslandCommit, onFleetOpen, onProjectOpen, onShipOpen, onFactoryOpen, onSkillsOpen, onDimOpen, onPersonasOpen, onCategoryOpen, onOpenTerminal, onDispatchFleet, onDispatchGroupFleet, canOpenTerminal, renderIsland }: VariantProps & {
  renderIsland: (island: Island, ctx: IslandCtx) => ReactNode;
}) {
  const { t, tx } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const { cam, camRef, panning, fit, zoomBy, animateTo, handlers } = useCanvasCamera(svgRef, worldRef);
  const [hover, setHover] = useState<string | null>(null);
  // Canvas objects live in the layout store, not in local state: Athena writes
  // to the same board out of band, and a `useState` snapshot would neither show
  // her work nor survive the next user commit (see useLayout.ts).
  const groups = useLayoutGroups();
  const links = useLayoutLinks();
  const notes = useLayoutNotes();
  const athenaCount = useAthenaObjectCount();
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [editingLink, setEditingLink] = useState<string | null>(null);
  const [rubber, setRubber] = useState<{ x: number; y: number } | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ slug: string; x: number; y: number } | null>(null);
  const [highlight, setHighlight] = useState<{ slug: string; key: string } | null>(null);
  const [fleetMenu, setFleetMenu] = useState<{ slug: string; state: string; x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // Single-level undo for the one-shot Tidy: the exact pre-tidy positions +
  // group rects. Present ⇒ the Undo affordance shows.
  const [undoSnap, setUndoSnap] = useState<{ positions: TidyResult; groups: GroupRect[] } | null>(null);
  // Keyboard cursor. The canvas was pointer-only: no island was reachable, and
  // the right-click dimension menu and double-click focus had no equivalent at
  // all. This is one roving cursor over the island set rather than N tab stops
  // — a 200-project portfolio must not become 200 tab presses, and the map is
  // spatial, so arrow keys navigate it spatially.
  const [kbFocus, setKbFocus] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
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

  // Track the viewport box so culling knows what world rect is on screen.
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setViewport((v) => (v.w === r.width && v.h === r.height ? v : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!fitted.current && scene.islands.length > 0) {
      fit(sceneBounds(scene.islands));
      fitted.current = true;
    }
  }, [scene.islands, fit]);

  // Group rollups need a little more than island centres — the state dot, the
  // blocker total, and whether each project can host a Fleet session.
  const groupMembers = useMemo<GroupMember[]>(
    () => scene.islands.map((i) => ({
      slug: i.slug, x: i.x, y: i.y, state: i.state, blockers: i.blockers,
      dispatchable: canOpenTerminal(i.slug),
    })),
    [scene.islands, canOpenTerminal],
  );

  const band = zoomBand(cam.z);
  // Quantized z for island props (~6% steps): a wheel-zoom gesture commits
  // state every frame, but islands only re-render when the quantized value
  // crosses a step — ~12 renders per zoom doubling instead of one per frame.
  // Counter-scaled banners are ≤3% off exact between steps; imperceptible.
  const zq = useMemo(() => Math.pow(1.06, Math.round(Math.log(cam.z) / Math.log(1.06))), [cam.z]);
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

  // Visible world rect (committed camera + one generous margin). Recomputed only
  // on committed camera changes — a render-free pan keeps the last rect and its
  // margin covers the drag; release re-culls. `null` until the viewport is
  // measured (render everything so nothing is missing on first paint).
  // Neighbor-dimming is applied imperatively: flipping a `dimmed` prop on
  // every island made each hover enter/leave a full-world render. Opacity is
  // the only thing that changes — write it straight to the island <g>s (they
  // carry data-mm-island + a CSS opacity transition).
  useLayoutEffect(() => {
    const els = worldRef.current?.querySelectorAll<SVGGElement>('[data-mm-island]');
    if (!els) return;
    for (const el of els) {
      const slug = el.getAttribute('data-mm-island')!;
      el.style.opacity = lit === null ? '' : lit.has(slug) ? '1' : '0.3';
    }
  }, [lit]);

  const visibleRect = useMemo(() => {
    if (!viewport.w || !viewport.h) return null;
    const m = CULL_MARGIN;
    return {
      minX: -cam.x / cam.z - m,
      maxX: (viewport.w - cam.x) / cam.z + m,
      minY: -cam.y / cam.z - m,
      maxY: (viewport.h - cam.y) / cam.z + m,
    };
  }, [viewport, cam]);

  // Islands actually on screen. Before the viewport is measured this is EMPTY,
  // not "everything": the measure + fit layout effects both run before paint,
  // so rendering the whole world in that first pass only to cull it in the
  // second cost N×~150 SVG nodes of pure waste — a large slice of the
  // first-open freeze. Nothing is missing; paint happens after pass 2.
  const visibleIslands = useMemo(
    () => (visibleRect
      ? scene.islands.filter((i) => i.x >= visibleRect.minX && i.x <= visibleRect.maxX && i.y >= visibleRect.minY && i.y <= visibleRect.maxY)
      : []),
    [scene.islands, visibleRect],
  );

  // ...and they mount in WAVES. Culling alone still commits every on-screen
  // island in ONE synchronous pass; at 30+ projects (13 dimension cells +
  // stat columns + banner each) that pass is seconds of blocked main thread.
  // A wave per animation frame lets the first ones paint while the rest stream
  // in. The budget only ever grows, so a later pan (already past the island
  // count) mounts immediately with no re-stagger.
  const [mountBudget, setMountBudget] = useState(MOUNT_WAVE_START);
  const waveSize = useRef(MOUNT_WAVE_START);
  const waveAt = useRef(0);
  const waveMeasuredFor = useRef(-1);
  useEffect(() => {
    if (mountBudget >= visibleIslands.length) return;
    // Size the NEXT wave from how long the one we just committed took. This is a
    // passive effect, so it runs after paint and the measurement covers the real
    // cost — render, commit and raster. Guarded on the budget it measured, so a
    // data-family arrival re-running this effect can't be mistaken for a slow
    // frame and shrink the wave to a crawl.
    if (waveMeasuredFor.current !== mountBudget) {
      waveMeasuredFor.current = mountBudget;
      const elapsed = waveAt.current === 0 ? 0 : performance.now() - waveAt.current;
      if (elapsed > MOUNT_FRAME_BUDGET_MS) waveSize.current = Math.max(MOUNT_WAVE_MIN, Math.floor(waveSize.current / 2));
      else if (elapsed > 0 && elapsed < MOUNT_FRAME_BUDGET_MS / 2) waveSize.current = Math.min(MOUNT_WAVE_MAX, waveSize.current + 2);
    }
    const id = requestAnimationFrame(() => {
      waveAt.current = performance.now();
      setMountBudget((n) => n + waveSize.current);
    });
    return () => cancelAnimationFrame(id);
  }, [mountBudget, visibleIslands.length]);

  // Fill ORDER: nearest the viewport centre first. The camera opens framed on
  // the whole portfolio, so on a cold load every island passes the cull and the
  // waves filled the map in scene order (alphabetical) — the middle of the
  // screen, which is exactly where the user is looking, arrived last. Ranking by
  // distance to the viewport centre makes the load resolve outward from there.
  //
  // Only the SET is chosen by rank; `mountedIslands` below stays in scene order,
  // so SVG paint order and React's child keys never shuffle underneath. `null`
  // once the budget covers everything — the rank is then pure waste, and this
  // memo would otherwise re-sort on every committed camera change.
  const mountRank = useMemo(() => {
    if (mountBudget >= visibleIslands.length || !visibleRect) return null;
    const cx = (visibleRect.minX + visibleRect.maxX) / 2;
    const cy = (visibleRect.minY + visibleRect.maxY) / 2;
    const d2 = (i: Island) => (i.x - cx) * (i.x - cx) + (i.y - cy) * (i.y - cy);
    const rank = new Map<string, number>();
    [...visibleIslands].sort((a, b) => d2(a) - d2(b)).forEach((i, k) => rank.set(i.slug, k));
    return rank;
  }, [mountBudget, visibleIslands, visibleRect]);

  // The keyboard cursor is always mounted, even mid-flight to an off-screen
  // island: focus travel is an animated pan, so without this the focused island
  // would be culled for the duration and the ring would draw over nothing.
  const mountedIslands = useMemo(() => {
    const base = mountRank === null
      ? visibleIslands
      : visibleIslands.filter((i) => (mountRank.get(i.slug) ?? 0) < mountBudget);
    if (!kbFocus || base.some((i) => i.slug === kbFocus)) return base;
    const f = bySlug.get(kbFocus);
    return f ? [...base, f] : base;
  }, [mountRank, mountBudget, visibleIslands, kbFocus, bySlug]);

  // Gesture-time world math reads the LIVE camera (camRef) so it stays correct
  // even mid-pan, when `cam` state is intentionally stale for render-freedom.
  const toWorld = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const c = camRef.current;
    return { x: (e.clientX - rect.left - c.x) / c.z, y: (e.clientY - rect.top - c.y) / c.z };
  };

  // Commits go straight to the store, which notifies every reader (this canvas
  // included). `persist: false` is a live drag frame: it still updates memory,
  // it just does not schedule a DB write until release.
  const commitGroups = (next: GroupRect[], persist = true) => saveGroups(next, persist);
  const commitLinks = (next: UserLink[]) => saveLinks(next);
  const commitNotes = (next: CanvasNote[], persist = true) => saveNotes(next, persist);

  /** Screen coords of a mouse event relative to the canvas container. */
  const toScreen = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const createLink = (from: string, to: string) => {
    const l: UserLink = { id: canvasId('l'), from, to, label: '', dashed: false, color: LINK_PALETTE[0], author: 'user' };
    commitLinks([...links, l]);
    setLinkSource(null);
    setEditingLink(l.id);
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

  // --- island-facing callbacks — referentially stable so React.memo'd islands
  //     skip re-rendering when only the camera transform (pan) changed. ----------
  const onHover = useEventCallback(setHover);
  const onIslandTap = useEventCallback((slug: string) => {
    // Connect tool, tap flow (fallback to the drag gesture): first tap marks the
    // source, second creates the link. Tapping the source again (or sea) cancels.
    if (mode !== 'connect') {
      onProjectOpen(slug);
      return;
    }
    if (!linkSource) setLinkSource(slug);
    else if (linkSource === slug) setLinkSource(null);
    else createLink(linkSource, slug);
  });
  const onConnectStart = useEventCallback((slug: string, e: React.PointerEvent) => {
    // Connect tool, drag flow: capture on the svg so moves keep arriving while
    // the rubber band follows the cursor; release near another island links it.
    if (mode !== 'connect' || e.button !== 0) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    connectDrag.current = { id: e.pointerId, from: slug, sx: e.clientX, sy: e.clientY };
  });
  const onIslandFocus = useEventCallback((slug: string) => {
    const i = bySlug.get(slug);
    // Linear tween to the island — no sudden jump (double-click zoom brief).
    if (i) fit({ minX: i.x - 480, maxX: i.x + 480, minY: i.y - 400, maxY: i.y + 400 }, true);
  });
  // Focus driven from OUTSIDE the shell (Athena composing a panel for a
  // project, a deep link). The request lives in `focusStore`; the shell answers
  // it by MOVING THE CAMERA — an off-screen island is not in the DOM (viewport
  // culling + the mount waves), so nothing here may look for a node. A request
  // whose island is not in the scene yet is left unhandled: the next derive
  // re-runs this effect and it lands then.
  const focusRequest = useCanvasFocus();
  const handledFocus = useRef(0);
  useEffect(() => {
    if (!focusRequest?.travel || focusRequest.seq === handledFocus.current) return;
    if (!bySlug.has(focusRequest.target.slug)) return;
    handledFocus.current = focusRequest.seq;
    onIslandFocus(focusRequest.target.slug);
  }, [focusRequest, bySlug, onIslandFocus]);

  const onIslandMenu = useEventCallback((slug: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const p = toScreen(e);
    const rect = svgRef.current?.getBoundingClientRect();
    setMenu({ slug, x: Math.min(p.x, (rect?.width ?? 600) - 320), y: Math.min(p.y, (rect?.height ?? 400) - 340) });
  });
  const onFleetList = useEventCallback((slug: string, state: string, e: React.MouseEvent) => {
    const p = toScreen(e);
    const rect = svgRef.current?.getBoundingClientRect();
    setFleetMenu({ slug, state, x: Math.min(p.x, (rect?.width ?? 600) - 244), y: Math.min(p.y + 10, (rect?.height ?? 400) - 280) });
  });
  // Page-supplied callbacks — stabilized so a page re-render (fleet poll, etc.)
  // doesn't invalidate every island's props.
  const onIslandCommitStable = useEventCallback(onIslandCommit);
  const onFleetOpenStable = useEventCallback(onFleetOpen);
  const onShipOpenStable = useEventCallback(onShipOpen);
  const onDimOpenStable = useEventCallback(onDimOpen);
  const onPersonasOpenStable = useEventCallback(onPersonasOpen);
  const onCategoryOpenStable = useEventCallback(onCategoryOpen);

  // --- Tidy map: one-shot relation-aware arrangement + single-level undo. -------
  // Islands are moved through the existing per-island commit (updates the page's
  // position overrides + persists via savePositions); the camera does the one
  // allowed animated transition. No per-island animation, no idle simulation.
  const onTidy = useEventCallback(() => {
    const list = scene.islands;
    if (list.length < 2) return;
    // Snapshot the exact prior layout for undo.
    const prior: TidyResult = {};
    for (const i of list) prior[i.slug] = { x: i.x, y: i.y };
    setUndoSnap({ positions: prior, groups: groups.map((g) => ({ ...g })) });

    // Pinned = user-moved islands (an entry in the positions store).
    const pinned = new Set(Object.keys(loadPositions()));
    // Group membership is geometric (centre inside the rect) — same test the
    // GroupLayer uses when a group carries its islands.
    const groupConstraints = groups.map((g) => ({
      members: list.filter((i) => i.x >= g.x && i.x <= g.x + g.w && i.y >= g.y && i.y <= g.y + g.h).map((i) => i.slug),
    }));
    const next = tidyLayout({
      islands: list.map((i) => ({ slug: i.slug, x: i.x, y: i.y })),
      edges: scene.edges.map((e) => ({ from: e.from, to: e.to, strength: e.strength })),
      pinned,
      groups: groupConstraints,
    });

    // Slide each group rect by its members' centroid delta so the box follows
    // its (now contiguous) cluster instead of being left behind.
    const movedGroups = groups.map((g, gi) => {
      const members = groupConstraints[gi]?.members ?? [];
      if (members.length === 0) return g;
      let dx = 0, dy = 0;
      for (const s of members) {
        const pr = prior[s]!;
        const nx = next[s] ?? pr;
        dx += nx.x - pr.x;
        dy += nx.y - pr.y;
      }
      return { ...g, x: g.x + dx / members.length, y: g.y + dy / members.length };
    });
    if (movedGroups.some((g, i) => g.x !== groups[i]!.x || g.y !== groups[i]!.y)) commitGroups(movedGroups);

    for (const i of list) {
      const p = next[i.slug];
      if (p && (p.x !== i.x || p.y !== i.y)) onIslandCommit(i.slug, p.x, p.y);
    }
    fit(sceneBounds(list.map((i) => ({ ...i, x: next[i.slug]?.x ?? i.x, y: next[i.slug]?.y ?? i.y }))), true);
  });

  const onUndoTidy = useEventCallback(() => {
    if (!undoSnap) return;
    for (const [slug, p] of Object.entries(undoSnap.positions)) onIslandCommit(slug, p.x, p.y);
    commitGroups(undoSnap.groups);
    const restored = scene.islands.map((i) => ({ ...i, ...(undoSnap.positions[i.slug] ?? {}) }));
    setUndoSnap(null);
    fit(sceneBounds(restored), true);
  });

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
          const g: GroupRect = { id: canvasId('g'), label: t.mastermind.group_default_label, ...r, author: 'user' };
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
        const n: CanvasNote = { id: canvasId('n'), x: p.x, y: p.y, text: '', size: 'md', font: 'inter', author: 'user' };
        commitNotes([...notes, n]);
        setEditingNote(n.id);
      }
    }
    handlers.onPointerUp(e);
  };

  // --- keyboard navigation -------------------------------------------------
  /** Screen position of an island's header, for menus opened from the keyboard. */
  const islandScreenPos = (i: Island) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const c = camRef.current;
    return {
      x: (rect?.left ?? 0) + i.x * c.z + c.x,
      y: (rect?.top ?? 0) + i.y * c.z + c.y,
    };
  };

  // --- programmatic canvas actions (canvasActionStore) -----------------------
  // One consumer effect answering the typed grammar — camera verbs reuse the
  // exact fit/animateTo the human affordances use; inspection verbs reuse the
  // page popover callbacks with an anchor synthesized at the island's screen
  // position. Serial on purpose: a batch executes in dispatch order, each
  // awaiting its camera settle, so readbacks are deterministic.
  const clampCamZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

  const cameraReadout = (): CanvasCameraReadout => {
    const c = camRef.current;
    const rect = svgRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 0;
    const h = rect?.height ?? 0;
    const visibleSlugs = w && h
      ? scene.islands
        .filter((i) => {
          const sx = i.x * c.z + c.x;
          const sy = i.y * c.z + c.y;
          return sx >= 0 && sx <= w && sy >= 0 && sy <= h;
        })
        .map((i) => i.slug)
      : [];
    return { x: c.x, y: c.y, z: c.z, band: zoomBand(c.z), viewport: { w, h }, visibleSlugs };
  };

  /** Tween to the island, centred, at the band's target z. */
  const travelToBand = (island: Island, band: ZoomBand) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 0;
    const h = rect?.height ?? 0;
    const z = clampCamZ(bandTargetZ(band));
    return animateTo({ z, x: w / 2 - island.x * z, y: h / 2 - island.y * z });
  };

  const runCanvasAction = useEventCallback(async (action: CanvasActionRequest): Promise<Omit<CanvasActionResult, 'seq'>> => {
    const fail = (reason: CanvasActionFailReason) => ({ ok: false as const, reason, camera: cameraReadout() });
    const okWith = (extra?: { payload?: unknown; clamped?: boolean }) => ({ ok: true as const, ...extra, camera: cameraReadout() });

    switch (action.kind) {
      case 'camera.read':
        return okWith();
      case 'camera.pan': {
        if (!Number.isFinite(action.dx) || !Number.isFinite(action.dy)) return fail('bad_request');
        const c = camRef.current;
        // Moving the VIEW by +dx world units means the world shifts left on
        // screen: camera translate decreases by dx·z (or by raw px for screen).
        const k = action.unit === 'screen' ? 1 : c.z;
        await animateTo({ z: c.z, x: c.x - action.dx * k, y: c.y - action.dy * k });
        return okWith();
      }
      case 'camera.zoom': {
        const c = camRef.current;
        const targetZ = action.band
          ? bandTargetZ(action.band)
          : typeof action.factor === 'number' && action.factor > 0 ? c.z * action.factor : NaN;
        if (!Number.isFinite(targetZ)) return fail('bad_request');
        const z = clampCamZ(targetZ);
        const rect = svgRef.current?.getBoundingClientRect();
        const w = rect?.width ?? 0;
        const h = rect?.height ?? 0;
        // Same pivot math as zoomAt, around the viewport centre.
        const k = z / c.z;
        await animateTo({ z, x: w / 2 - (w / 2 - c.x) * k, y: h / 2 - (h / 2 - c.y) * k });
        return okWith(z !== targetZ ? { clamped: true } : undefined);
      }
      case 'camera.focus': {
        const island = bySlug.get(action.slug);
        if (!island) return fail('unknown_slug');
        await travelToBand(island, action.band ?? 'close');
        return okWith();
      }
      case 'camera.fit': {
        let list = scene.islands;
        if (action.slugs) {
          const picked = action.slugs.map((s) => bySlug.get(s));
          if (picked.some((i) => !i)) return fail('unknown_slug');
          list = picked as Island[];
          if (list.length === 0) return fail('bad_request');
        }
        await fit(sceneBounds(list), true);
        return okWith();
      }
      case 'island.read':
      case 'dim.read':
      case 'dim.open':
      case 'category.open':
      case 'island.menu': {
        // Inspection refuses the demo scene outright — same rule as the scene
        // publisher and the Rust read ops: never describe projects that aren't there.
        if (scene.demo) return fail('demo_scene');
        const island = bySlug.get(action.slug);
        if (!island) return fail('unknown_slug');
        if (action.kind === 'island.read') return okWith({ payload: islandReadPayload(island) });
        if (action.kind === 'dim.read' || action.kind === 'dim.open') {
          const node = island.nodes.find((n) => n.key === action.key);
          if (!node) return fail('unknown_target');
          if (action.kind === 'dim.read') return okWith({ payload: dimReadPayload(node) });
          if (!bandGte(zoomBand(camRef.current.z), DIM_OPEN_MIN_BAND)) {
            if (action.travel === false) return fail('band_too_far');
            await travelToBand(island, 'close');
          }
          const p = islandScreenPos(island);
          onDimOpenStable(island.slug, node, synthAnchorEvent(p.x, p.y));
          return okWith({ payload: dimReadPayload(node) });
        }
        if (action.kind === 'category.open') {
          const cat = categoryNodes(island.nodes).find((cn) => cn.key === action.category);
          if (!cat) return fail('unknown_target');
          const p = islandScreenPos(island);
          onCategoryOpenStable(island.slug, cat, synthAnchorEvent(p.x, p.y));
          return okWith({
            payload: {
              key: cat.key,
              status: cat.status,
              total: cat.total,
              solid: cat.solid,
              attention: cat.attention,
              dims: cat.nodes.map(dimReadPayload),
            },
          });
        }
        // island.menu — same clamp the pointer path applies (setMenu is
        // container-relative where popover anchors are client coords).
        const p = islandScreenPos(island);
        const rect = svgRef.current?.getBoundingClientRect();
        setMenu({
          slug: island.slug,
          x: Math.min(p.x - (rect?.left ?? 0), (rect?.width ?? 600) - 320),
          y: Math.min(p.y - (rect?.top ?? 0), (rect?.height ?? 400) - 340),
        });
        return okWith({ payload: { terminalEnabled: canOpenTerminal(island.slug), navEnabled: !scene.demo } });
      }
      default:
        return fail('bad_request');
    }
  });

  const actionVersion = useCanvasActionVersion();
  useEffect(() => {
    const entries = takeCanvasActions();
    if (entries.length === 0) return;
    void (async () => {
      for (const entry of entries) {
        const result = await runCanvasAction(entry.action);
        entry.settle({ seq: entry.seq, ...result });
      }
    })();
  }, [actionVersion, runCanvasAction]);

  useCanvasTestBridge();

  const stateLabel = (s: Island['state']) =>
    ({
      healthy: t.mastermind.kb_state_healthy,
      building: t.mastermind.kb_state_building,
      warning: t.mastermind.kb_state_warning,
      critical: t.mastermind.kb_state_critical,
    })[s];

  const describeIsland = (i: Island) => {
    const blockers = i.blockers
      ? ` ${tx(i.blockers === 1 ? t.mastermind.kb_blockers_one : t.mastermind.kb_blockers_other, { count: i.blockers })}.`
      : '';
    return `${i.name}. ${stateLabel(i.state)}.${blockers}`;
  };

  const focusSlug = (slug: string, travel = true) => {
    const i = bySlug.get(slug);
    if (!i) return;
    setKbFocus(slug);
    setAnnounce(describeIsland(i));
    if (travel) onIslandFocus(slug);
  };

  /** Move the cursor one step in a direction (see kbNav for the geometry). */
  const stepFocus = (dx: number, dy: number) => {
    const cur = kbFocus ? bySlug.get(kbFocus) : null;
    if (!cur) {
      // Entering the map: start from whatever sits nearest the viewport centre.
      const c = camRef.current;
      const entry = nearestTo(scene.islands, (viewport.w / 2 - c.x) / c.z, (viewport.h / 2 - c.y) / c.z);
      if (entry) focusSlug(entry.slug, false);
      return;
    }
    const next = pickInDirection(scene.islands, cur, dx, dy);
    if (next) focusSlug(next.slug);
  };

  const onCanvasKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    const cur = kbFocus ? bySlug.get(kbFocus) : null;
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); stepFocus(1, 0); return;
      case 'ArrowLeft': e.preventDefault(); stepFocus(-1, 0); return;
      case 'ArrowDown': e.preventDefault(); stepFocus(0, 1); return;
      case 'ArrowUp': e.preventDefault(); stepFocus(0, -1); return;
      case 'Home': {
        e.preventDefault();
        const first = [...scene.islands].sort((a, b) => a.name.localeCompare(b.name))[0];
        if (first) focusSlug(first.slug);
        return;
      }
      case 'Enter':
        if (!cur) { e.preventDefault(); stepFocus(1, 0); return; }
        e.preventDefault();
        onIslandTap(cur.slug);
        return;
      case ' ':
        if (!cur) return;
        e.preventDefault();
        onIslandFocus(cur.slug);
        setAnnounce(tx(t.mastermind.kb_framed, { name: cur.name }));
        return;
      // Shift+F10 and the ContextMenu key are the platform keyboard equivalents
      // of right-click — the island dimension menu had no other way in.
      case 'ContextMenu':
      case 'F10': {
        if (e.key === 'F10' && !e.shiftKey) return;
        if (!cur) return;
        e.preventDefault();
        const p = islandScreenPos(cur);
        setMenu({ slug: cur.slug, x: p.x, y: p.y });
        return;
      }
      case 'Escape':
        if (kbFocus) { setKbFocus(null); setAnnounce(t.mastermind.kb_left); }
        return;
      default:
    }
  };

  const kbIsland = kbFocus ? bySlug.get(kbFocus) ?? null : null;

  const editingGroup = editing ? groups.find((g) => g.id === editing) ?? null : null;
  const editingLinkObj = editingLink ? links.find((l) => l.id === editingLink) ?? null : null;
  const editorAnchor = useMemo(() => {
    if (!editingLinkObj) return null;
    const a = bySlug.get(editingLinkObj.from);
    const b = bySlug.get(editingLinkObj.to);
    if (!a || !b) return null;
    return { x: ((a.x + b.x) / 2) * cam.z + cam.x, y: ((a.y + b.y) / 2) * cam.z + cam.y };
  }, [editingLinkObj, bySlug, cam]);

  // Per-island context — created fresh per island, but every field is either a
  // primitive or a stable callback, so React.memo'd islands compare equal and
  // skip re-rendering unless z / band / mode / their own dim/highlight changed.
  const ctxFor = (i: Island): IslandCtx => ({
    z: zq,
    band,
    mode,
    onHover,
    onIslandCommit: onIslandCommitStable,
    onFleetOpen: onFleetOpenStable,
    onIslandTap,
    onShipOpen: onShipOpenStable,
    onConnectStart,
    onIslandFocus,
    onIslandMenu,
    highlightKey: highlight?.slug === i.slug ? highlight.key : null,
    onFleetList,
    onDimOpen: onDimOpenStable,
    onPersonasOpen: onPersonasOpenStable,
    onCategoryOpen: onCategoryOpenStable,
  });

  return (
    <>
      <svg
        ref={svgRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDoubleClick={handlers.onDoubleClick}
        onKeyDown={onCanvasKeyDown}
        onBlur={() => setKbFocus(null)}
        data-testid="mastermind-canvas"
        tabIndex={0}
        role="application"
        aria-label={`${t.mastermind.canvas_label} ${t.mastermind.kb_hint}`}
        className="absolute inset-0 w-full h-full select-none focus-ring"
        style={{ touchAction: 'none', cursor: mode === 'group' || mode === 'note' ? 'crosshair' : panning ? 'grabbing' : 'grab' }}
      >
        <defs>
          <radialGradient id="mm-sea" cx="32%" cy="22%" r="95%">
            <stop offset="0%" stopColor={mix('var(--primary)', 7, 'var(--background)')} />
            <stop offset="55%" stopColor="var(--background)" />
            <stop offset="100%" stopColor={mix('var(--secondary)', 45, 'var(--background)')} />
          </radialGradient>
          {/* Per-state halo gradients — the soft "coast" behind each island.
              Replaces the old feGaussianBlur filter: hundreds of live blur
              surfaces re-rasterized on every zoom frame; four shared gradients
              cost nothing. */}
          {(Object.keys(STATE_INK) as Array<keyof typeof STATE_INK>).map((state) => (
            <radialGradient key={state} id={`mm-halo-${state}`}>
              <stop offset="0%" stopColor={mix(STATE_INK[state], 10, 'var(--secondary)')} stopOpacity="1" />
              <stop offset="62%" stopColor={mix(STATE_INK[state], 10, 'var(--secondary)')} stopOpacity="1" />
              <stop offset="100%" stopColor={mix(STATE_INK[state], 10, 'var(--secondary)')} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>

        <rect width="100%" height="100%" fill="url(#mm-sea)" />

        <g ref={worldRef} transform={`translate(${cam.x} ${cam.y}) scale(${cam.z})`}>
          <GroupLayer
            groups={groups}
            draft={draft ? normalize(draft) : null}
            z={cam.z}
            mode={mode}
            islands={groupMembers}
            onGroupsChange={commitGroups}
            onIslandCommit={onIslandCommit}
            onRename={setEditing}
            onDelete={(id) => commitGroups(groups.filter((g) => g.id !== id))}
            onDispatchGroup={(id, slugs) => onDispatchGroupFleet(slugs, groups.find((g) => g.id === id)?.label ?? '')}
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
          {/* Islands: culled to the visible world rect (+ margin) and mounted in
              waves, each memoized so a render-free pan re-renders none of them. */}
          {mountedIslands.map((i) => renderIsland(i, ctxFor(i)))}
          <NoteLayer notes={notes} z={cam.z} mode={mode} onNotesChange={commitNotes} onEdit={setEditingNote} />
          {/* connect overlay — ABOVE the islands so source/target/rubber are
              unmistakable (the round-5 under-island ring was barely visible) */}
          {/* Keyboard cursor ring — drawn by the shell, not the island, so no
              variant's memo'd renderer changes and every variant gets it. */}
          {kbIsland && <KbFocusRing island={kbIsland} z={cam.z} />}
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

      {/* Screen-reader channel for the keyboard cursor. The ring is the visual
          answer to "where am I"; this is the spoken one. */}
      <span className="sr-only" role="status" aria-live="polite" data-testid="mm-kb-announce">
        {announce}
      </span>

      <DimLegend />
      <ZoomBadge z={cam.z} />
      {/* Athena's contribution, and the one way out of it. Sits with the other
          global canvas controls, above the zoom cluster. */}
      <AthenaRevertControl count={athenaCount} onRevert={revertAthenaObjects} />
      <ZoomControls
        onZoomBy={zoomBy}
        onFit={() => fit(sceneBounds(scene.islands), true)}
        onTidy={onTidy}
        onUndo={onUndoTidy}
        canUndo={undoSnap !== null}
      />

      {/* inline label editor for the group being named/renamed */}
      {editingGroup && (
        <input
          key={editingGroup.id}
          autoFocus
          defaultValue={editingGroup.label}
          placeholder={t.mastermind.group_label_placeholder}
          className="absolute z-20 px-2 py-1 typo-caption rounded-input bg-secondary border border-primary/40 text-foreground outline-none w-44"
          style={{ left: editingGroup.x * cam.z + cam.x + 4, top: editingGroup.y * cam.z + cam.y - 34 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(null);
          }}
          onBlur={(e) => {
            const label = e.target.value.trim() || t.mastermind.group_default_label;
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
            terminalEnabled={canOpenTerminal(menu.slug)}
            navEnabled={!scene.demo}
            onOpenTerminal={() => { onOpenTerminal(menu.slug); setMenu(null); setHighlight(null); }}
            onDispatchFleet={() => { onDispatchFleet(menu.slug); setMenu(null); setHighlight(null); }}
            onOpenFactory={() => onFactoryOpen(menu.slug)}
            onOpenShip={() => onShipOpen(menu.slug)}
            onOpenSkills={() => onSkillsOpen(menu.slug)}
            onDimOpen={(node, e) => { onDimOpen(menu.slug, node, e); setHighlight(null); }}
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

/** Minimal synthetic anchor for the page popover callbacks — every consumer
 *  reads only clientX/clientY (see MastermindPage.onDimOpen); the no-op
 *  methods are defensive against a future handler calling them. */
const synthAnchorEvent = (x: number, y: number): React.MouseEvent =>
  ({
    clientX: x,
    clientY: y,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  }) as unknown as React.MouseEvent;

const normalize = (d: { x0: number; y0: number; x1: number; y1: number }) => ({
  x: Math.min(d.x0, d.x1),
  y: Math.min(d.y0, d.y1),
  w: Math.abs(d.x1 - d.x0),
  h: Math.abs(d.y1 - d.y0),
});

/** Keyboard-cursor ring. Counter-scaled like the connect rings so it reads the
 *  same thickness at every zoom, and deliberately solid where connect's is
 *  dashed — "you are here" must not be mistaken for "link source". */
function KbFocusRing({ island, z }: { island: Island; z: number }) {
  const k = 1 / z;
  return (
    <g transform={`translate(${island.x} ${island.y}) scale(${k})`} pointerEvents="none">
      <circle r={46} fill="none" stroke={mix('var(--accent)', 95)} strokeWidth={3} />
      <circle r={53} fill="none" stroke={mix('var(--accent)', 40)} strokeWidth={1.5} />
    </g>
  );
}

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
