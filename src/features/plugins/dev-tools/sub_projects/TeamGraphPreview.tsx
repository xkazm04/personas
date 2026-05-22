import { useMemo } from 'react';
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
      </div>
      <div className="rounded-card border border-primary/10 bg-secondary/15 overflow-hidden">
        <svg
          viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full block"
          style={{ height: PREVIEW_HEIGHT }}
          aria-label={t.plugins.dev_projects.team_preview_canvas_aria}
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
        </svg>
      </div>
    </section>
  );
}
