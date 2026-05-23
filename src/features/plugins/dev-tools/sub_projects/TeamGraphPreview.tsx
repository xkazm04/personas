import { useCallback, useMemo, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';
import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';

interface TeamGraphPreviewProps {
  members: PersonaTeamMember[];
  connections: PersonaTeamConnection[];
  personas: Persona[];
  teamColor: string;
  /**
   * Called after a node click successfully navigates to that persona's
   * editor. The modal owner uses this to dismiss its overlay so the user
   * lands cleanly on the editor instead of stacking surfaces.
   */
  onPersonaOpened?: (personaId: string) => void;
}

// Final rendered canvas size in CSS pixels. SVG scales to fit this rect.
const PREVIEW_WIDTH = 460;
const PREVIEW_HEIGHT = 180;
const NODE_RADIUS = 10;
const PADDING = 24;

// Pan/zoom bounds (cycle 25). The default view is `scale=1, tx=ty=0` —
// graph fits the viewport. MIN_SCALE allows zooming OUT to half the
// default when the user wants to see context after panning; MAX_SCALE
// allows zooming IN by 4× to inspect crowded clusters. Pan distance is
// not clamped — the visual band is the original viewBox, so a heavily
// panned graph just disappears off-screen; the Reset button restores.
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
// Per-tick zoom factor on the wheel. ~1.1 gives a smooth ramp at a
// typical wheel notch; multiplicative so the rate is constant across
// the zoom range.
const WHEEL_ZOOM_STEP = 1.1;

/**
 * Read-only fit-to-rect SVG mini-canvas for the bound PersonaTeam.
 *
 * Uses each `PersonaTeamMember`'s stored `position_x` / `position_y` (set
 * by the full TeamCanvas during interactive layout) to plot a directed
 * graph: nodes coloured by their persona, edges drawn between members
 * referenced in `PersonaTeamConnection.source_member_id` /
 * `target_member_id`. Feedback edges render dashed so they read as
 * "backward" without needing an explicit legend.
 *
 * Auto-fits the entire graph into the fixed viewport with a transform
 * computed from the members' bounding box, so layouts created at any
 * canvas zoom level render correctly here. If all members are at (0, 0)
 * — the default for never-edited teams — the fallback grid arranges them
 * left-to-right so the preview still says "there's a team here, it just
 * hasn't been laid out yet" rather than collapsing to a single dot.
 */
export function TeamGraphPreview({
  members,
  connections,
  personas,
  teamColor,
  onPersonaOpened,
}: TeamGraphPreviewProps) {
  const { t } = useTranslation();
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setAgentTab = useSystemStore((s) => s.setAgentTab);

  const handleNodeClick = (personaId: string) => {
    // Open the persona's editor: switch to the Agents section, set the
    // "all" tab (not group/team subview), select the persona. Mirrors the
    // navigation cockpit widgets do when surfacing a specific persona.
    setSidebarSection('personas');
    setAgentTab('all');
    selectPersona(personaId);
    onPersonaOpened?.(personaId);
  };

  const layout = useMemo(() => {
    if (members.length === 0) return null;
    const personaById = new Map(personas.map((p) => [p.id, p]));

    // Identify members that haven't been placed on the canvas yet
    // (position_x === 0 && position_y === 0 is the schema default).
    const allUnplaced = members.every((m) => m.position_x === 0 && m.position_y === 0);
    const points = allUnplaced
      ? members.map((m, idx) => ({
          id: m.id,
          personaId: m.persona_id,
          x: idx,
          y: 0,
          color: personaById.get(m.persona_id)?.color ?? teamColor,
          name: personaById.get(m.persona_id)?.name ?? '',
        }))
      : members.map((m) => ({
          id: m.id,
          personaId: m.persona_id,
          x: m.position_x,
          y: m.position_y,
          color: personaById.get(m.persona_id)?.color ?? teamColor,
          name: personaById.get(m.persona_id)?.name ?? '',
        }));

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    // Width / height of the source rect; floor at 1 so single-point teams
    // don't divide by zero when computing scale.
    const srcW = Math.max(1, maxX - minX);
    const srcH = Math.max(1, maxY - minY);
    const targetW = PREVIEW_WIDTH - PADDING * 2;
    const targetH = PREVIEW_HEIGHT - PADDING * 2;
    const scale = Math.min(targetW / srcW, targetH / srcH);
    // Center the (possibly smaller-than-target) scaled graph inside the rect.
    const scaledW = srcW * scale;
    const scaledH = srcH * scale;
    const offsetX = (PREVIEW_WIDTH - scaledW) / 2 - minX * scale;
    const offsetY = (PREVIEW_HEIGHT - scaledH) / 2 - minY * scale;

    const project = (px: number, py: number) => ({
      x: px * scale + offsetX,
      y: py * scale + offsetY,
    });

    const placedNodes = points.map((p) => ({
      ...p,
      ...project(p.x, p.y),
    }));
    const placedById = new Map(placedNodes.map((n) => [n.id, n]));

    const placedEdges = connections
      .map((c) => {
        const a = placedById.get(c.source_member_id);
        const b = placedById.get(c.target_member_id);
        if (!a || !b) return null;
        return {
          id: c.id,
          from: { x: a.x, y: a.y },
          to: { x: b.x, y: b.y },
          isFeedback: c.connection_type === 'feedback',
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    return { nodes: placedNodes, edges: placedEdges, allUnplaced };
  }, [members, connections, personas, teamColor]);

  // Pan/zoom state (cycle 25). Stored as scale + (tx, ty) translation,
  // applied as a single <g transform="translate(...) scale(...)"> on the
  // graph contents. Wheel events zoom around the cursor; mousedown-drag
  // on the empty canvas pans. Node-clicks still navigate (see hit-test
  // guard in handlePointerDown — clicks on a <g role="button"> skip pan).
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const panRef = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const resetView = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    // Without preventDefault the outer modal's overflow-y-auto eats the
    // wheel and the user can't zoom — they just scroll the modal body.
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // Convert cursor position to SVG viewBox coordinates so we can zoom
    // around the cursor (not the center). This keeps the point under the
    // cursor stationary as the scale changes — the standard "zoom-to-cursor"
    // affordance every map app uses.
    const vx = ((e.clientX - rect.left) / rect.width) * PREVIEW_WIDTH;
    const vy = ((e.clientY - rect.top) / rect.height) * PREVIEW_HEIGHT;
    const zoomIn = e.deltaY < 0;
    const factor = zoomIn ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
    setScale((prev) => {
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev * factor));
      if (next === prev) return prev;
      // Compose translate so (vx, vy) maps to itself before+after.
      // newTx = vx - (vx - oldTx) * (next/prev)
      setTranslate((tr) => ({
        x: vx - (vx - tr.x) * (next / prev),
        y: vy - (vy - tr.y) * (next / prev),
      }));
      return next;
    });
  }, []);

  const handleSvgPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    // Skip if the click landed on a node (the node's own onClick handles it).
    // Node groups carry role="button"; we walk the event target's ancestry to
    // detect that.
    let el = e.target as Element | null;
    while (el && el !== e.currentTarget) {
      if (el.getAttribute && el.getAttribute('role') === 'button') return;
      el = el.parentElement;
    }
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      tx: translate.x,
      ty: translate.y,
    };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }, [translate.x, translate.y]);

  const handleSvgPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (!pan) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // Convert pixel delta to viewBox delta so panning feels 1:1 with the
    // visible image regardless of how the SVG is scaled by CSS.
    const dxVB = ((e.clientX - pan.startX) / rect.width) * PREVIEW_WIDTH;
    const dyVB = ((e.clientY - pan.startY) / rect.height) * PREVIEW_HEIGHT;
    setTranslate({ x: pan.tx + dxVB, y: pan.ty + dyVB });
  }, []);

  const handleSvgPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    panRef.current = null;
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      // Not captured (release on a non-down event). Harmless.
    }
  }, []);

  const isTransformed = scale !== 1 || translate.x !== 0 || translate.y !== 0;

  if (!layout) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="typo-label uppercase tracking-wider text-foreground/70">
          {t.plugins.dev_projects.team_preview_canvas}
        </h3>
        {layout.allUnplaced && (
          <span className="typo-caption text-foreground/50">
            ({t.plugins.dev_projects.team_preview_canvas_unplaced})
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {isTransformed && (
            <button
              type="button"
              onClick={resetView}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-caption text-foreground/60 hover:text-foreground/90 hover:bg-secondary/40 rounded-card transition-colors"
              title={t.plugins.dev_projects.team_preview_canvas_reset_title}
            >
              <Maximize2 className="w-3 h-3" />
              {t.plugins.dev_projects.team_preview_canvas_reset}
            </button>
          )}
          <span className="typo-caption text-foreground/40 font-mono tabular-nums">
            {Math.round(scale * 100)}%
          </span>
        </span>
      </div>
      <div className="rounded-card border border-primary/10 bg-secondary/15 overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full block"
          style={{ height: PREVIEW_HEIGHT, cursor: panRef.current ? 'grabbing' : 'grab' }}
          aria-label={t.plugins.dev_projects.team_preview_canvas_aria}
          onWheel={handleWheel}
          onPointerDown={handleSvgPointerDown}
          onPointerMove={handleSvgPointerMove}
          onPointerUp={handleSvgPointerUp}
          onPointerCancel={handleSvgPointerUp}
        >
          {/* Connection arrowhead — neutral, scales with the line color via stroke. */}
          <defs>
            <marker
              id="team-graph-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={colorWithAlpha(teamColor, 0.7)} />
            </marker>
          </defs>

          {/* Pan/zoom layer (cycle 25). Edges + nodes ride this group so a
              single transform handles both. Translate before scale so the
              origin stays the viewBox top-left and the math in handleWheel
              composes consistently. */}
          <g transform={`translate(${translate.x} ${translate.y}) scale(${scale})`}>

          {/* Edges first so they sit below the node circles. */}
          {layout.edges.map((e) => (
            <line
              key={e.id}
              x1={e.from.x}
              y1={e.from.y}
              x2={e.to.x}
              y2={e.to.y}
              stroke={colorWithAlpha(teamColor, e.isFeedback ? 0.45 : 0.7)}
              strokeWidth={1.5}
              strokeDasharray={e.isFeedback ? '4 3' : undefined}
              markerEnd="url(#team-graph-arrow)"
            />
          ))}

          {/* Nodes — circle filled with the persona's own color, ringed in
              the team color so the team identity is consistent. Clickable:
              opens the persona's editor. */}
          {layout.nodes.map((n) => (
            <g
              key={n.id}
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer' }}
              onClick={() => handleNodeClick(n.personaId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleNodeClick(n.personaId);
                }
              }}
              aria-label={`${n.name} — ${t.plugins.dev_projects.team_preview_canvas_open_persona}`}
            >
              <title>
                {n.name} — {t.plugins.dev_projects.team_preview_canvas_open_persona}
              </title>
              <circle
                cx={n.x}
                cy={n.y}
                r={NODE_RADIUS}
                fill={colorWithAlpha(n.color, 0.55)}
                stroke={colorWithAlpha(teamColor, 0.9)}
                strokeWidth={1.5}
                className="transition-all hover:opacity-85"
              />
              {/* Subtle hover halo — pure CSS, costs nothing if user never hovers */}
              <circle
                cx={n.x}
                cy={n.y}
                r={NODE_RADIUS + 4}
                fill="transparent"
                stroke={colorWithAlpha(teamColor, 0)}
                strokeWidth={1}
                className="transition-all hover:stroke-current"
                style={{ color: colorWithAlpha(teamColor, 0.5) }}
              />
            </g>
          ))}
          </g>
        </svg>
      </div>
    </section>
  );
}
