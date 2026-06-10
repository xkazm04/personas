import { useId, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import type { TeamPreset } from '@/lib/bindings/TeamPreset';

/**
 * Full-size, interactive connection graph for a TeamPreset manifest —
 * the in-app upgrade over the modal's tiny `PresetGraphAdapter`. Renders
 * the author-set `(x, y)` layout into a responsive viewBox with:
 *
 *   - labelled node cards (role + short template name) rather than
 *     2-letter circles, so the team is readable at a glance;
 *   - curved edges with arrowheads, sequential (solid, team colour) vs
 *     feedback (dashed, warning tone) clearly distinguished + a legend;
 *   - hover focus — hovering a node or edge dims everything not on its
 *     path, so a dense graph stays legible;
 *   - optional selection dimming (deselected members fade) and click-to-
 *     toggle so the graph itself can be the include/exclude surface.
 *
 * Pure presentational + local hover state; all data comes from the
 * preset manifest and the caller's selection set.
 */

interface PresetConnectionGraphProps {
  preset: TeamPreset;
  /** role → friendly template name (from the adoption schema). */
  labelByRole?: Map<string, string>;
  /** Roles currently included; deselected nodes/edges fade. Omit = all on. */
  selectedRoles?: Set<string>;
  /** Click a node to toggle its membership (makes the graph the selection surface). */
  onToggleRole?: (role: string) => void;
  /** Externally-driven focus (e.g. roster hover in the split variant). */
  focusRole?: string | null;
  /** SVG pixel height; width is always 100%. Default 320. */
  height?: number;
  /** Hide the sequential/feedback legend (when the host renders its own). */
  hideLegend?: boolean;
  className?: string;
}

const PADDING = 64;
const NODE_W = 132;
const NODE_H = 46;

export function PresetConnectionGraph({
  preset,
  labelByRole,
  selectedRoles,
  onToggleRole,
  focusRole = null,
  height = 320,
  hideLegend = false,
  className = '',
}: PresetConnectionGraphProps) {
  const { t } = useTranslation();
  const rawId = useId();
  const markerId = `preset-graph-arrow-${rawId.replace(/:/g, '')}`;
  const markerFeedbackId = `${markerId}-fb`;
  const [hovered, setHovered] = useState<string | null>(null);

  const teamColor = preset.team.color ?? preset.color;
  const VIEW_W = 1200;
  const VIEW_H = Math.max(220, (height / 1) * (1200 / 900)); // keep a wide aspect

  const layout = useMemo(() => {
    if (preset.members.length === 0) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const m of preset.members) {
      minX = Math.min(minX, m.x); maxX = Math.max(maxX, m.x);
      minY = Math.min(minY, m.y); maxY = Math.max(maxY, m.y);
    }
    const srcW = Math.max(1, maxX - minX);
    const srcH = Math.max(1, maxY - minY);
    const targetW = VIEW_W - PADDING * 2;
    const targetH = VIEW_H - PADDING * 2;
    const scale = Math.min(targetW / srcW, targetH / srcH);
    const scaledW = srcW * scale;
    const scaledH = srcH * scale;
    const offsetX = (VIEW_W - scaledW) / 2 - minX * scale;
    const offsetY = (VIEW_H - scaledH) / 2 - minY * scale;
    const project = (px: number, py: number) => ({ x: px * scale + offsetX, y: py * scale + offsetY });

    const nodesByRole = new Map(
      preset.members.map((m) => {
        const { x, y } = project(m.x, m.y);
        return [m.role, { role: m.role, templateId: m.template_id, x, y }];
      }),
    );
    const edges = preset.connections
      .map((c, i) => {
        const from = nodesByRole.get(c.from);
        const to = nodesByRole.get(c.to);
        if (!from || !to) return null;
        return {
          id: `${c.from}->${c.to}-${i}`,
          from: c.from,
          to: c.to,
          x1: from.x, y1: from.y, x2: to.x, y2: to.y,
          isFeedback: c.connection_type === 'feedback',
          label: c.label,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    return { nodes: Array.from(nodesByRole.values()), edges };
  }, [preset, VIEW_H]);

  if (!layout) return null;

  const isActive = (role: string) => !selectedRoles || selectedRoles.has(role);
  const focus = hovered ?? focusRole;
  const edgeFocused = (e: { from: string; to: string }) =>
    !focus || e.from === focus || e.to === focus;
  const nodeFocused = (role: string) =>
    !focus || role === focus || layout.edges.some((e) => (e.from === focus && e.to === role) || (e.to === focus && e.from === role));

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full block"
        style={{ height }}
        role="img"
        aria-label={t.templates.presets.preview_graph_aria}
      >
        <defs>
          <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={colorWithAlpha(teamColor, 0.85)} />
          </marker>
          <marker id={markerFeedbackId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-status-warning" />
          </marker>
        </defs>

        {/* Edges */}
        {layout.edges.map((e) => {
          const active = isActive(e.from) && isActive(e.to);
          const focused = edgeFocused(e);
          const dx = e.x2 - e.x1;
          const dy = e.y2 - e.y1;
          // Curve feedback edges in the opposite bow so a back-edge reads
          // as a distinct loop rather than overlapping the forward edge.
          const bow = e.isFeedback ? -0.18 : 0.12;
          const mx = (e.x1 + e.x2) / 2 - dy * bow;
          const my = (e.y1 + e.y2) / 2 + dx * bow;
          const opacity = (active ? 1 : 0.25) * (focused ? 1 : 0.18);
          return (
            <g key={e.id} opacity={opacity} className="transition-opacity duration-200">
              <path
                d={`M ${e.x1} ${e.y1} Q ${mx} ${my} ${e.x2} ${e.y2}`}
                fill="none"
                stroke={e.isFeedback ? undefined : colorWithAlpha(teamColor, 0.75)}
                className={e.isFeedback ? 'stroke-status-warning' : undefined}
                strokeWidth={focus && focused ? 3 : 2}
                strokeDasharray={e.isFeedback ? '7 5' : undefined}
                markerEnd={`url(#${e.isFeedback ? markerFeedbackId : markerId})`}
              />
              {/* Edge label appears only when its path is focused — keeps a
                  dense graph clean until the user inspects a node. */}
              {focus && focused && e.label && (
                <text
                  x={mx}
                  y={my - 6}
                  textAnchor="middle"
                  className="fill-foreground"
                  style={{ fontSize: '13px', fontWeight: 500 }}
                >
                  {truncate(e.label, 46)}
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {layout.nodes.map((n) => {
          const active = isActive(n.role);
          const focused = nodeFocused(n.role);
          const label = labelByRole?.get(n.role) ?? n.templateId;
          const clickable = !!onToggleRole;
          return (
            <g
              key={n.role}
              transform={`translate(${n.x - NODE_W / 2}, ${n.y - NODE_H / 2})`}
              opacity={focused ? 1 : 0.3}
              className="transition-opacity duration-200"
              style={{ cursor: clickable ? 'pointer' : 'default' }}
              onMouseEnter={() => setHovered(n.role)}
              onMouseLeave={() => setHovered(null)}
              onClick={clickable ? () => onToggleRole!(n.role) : undefined}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={10}
                fill={active ? colorWithAlpha(teamColor, 0.16) : 'transparent'}
                stroke={colorWithAlpha(teamColor, active ? 0.85 : 0.4)}
                strokeWidth={active ? 1.5 : 1.25}
                strokeDasharray={active ? undefined : '5 4'}
              />
              <circle cx={16} cy={NODE_H / 2} r={5} fill={colorWithAlpha(teamColor, active ? 1 : 0.5)} />
              <text
                x={30}
                y={18}
                className="fill-foreground"
                style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}
              >
                {n.role.slice(0, 14)}
              </text>
              <text
                x={30}
                y={33}
                className="fill-foreground/70"
                style={{ fontSize: '12px' }}
              >
                {truncate(label, 16)}
              </text>
            </g>
          );
        })}
      </svg>

      {!hideLegend && (
        <div className="flex items-center gap-4 mt-1 px-1">
          <span className="inline-flex items-center gap-1.5 typo-caption text-foreground">
            <svg width="22" height="8" aria-hidden>
              <line x1="0" y1="4" x2="22" y2="4" stroke={colorWithAlpha(teamColor, 0.8)} strokeWidth="2" />
            </svg>
            {t.templates.presets.graph_legend_sequential}
          </span>
          <span className="inline-flex items-center gap-1.5 typo-caption text-foreground">
            <svg width="22" height="8" aria-hidden>
              <line x1="0" y1="4" x2="22" y2="4" className="stroke-status-warning" strokeWidth="2" strokeDasharray="5 3" />
            </svg>
            {t.templates.presets.graph_legend_feedback}
          </span>
        </div>
      )}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
