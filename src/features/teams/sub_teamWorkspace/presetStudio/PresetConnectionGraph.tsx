import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import type { TeamPreset } from '@/lib/bindings/TeamPreset';

/**
 * Full-size, interactive connection graph for a TeamPreset manifest —
 * the in-app upgrade over the modal's tiny `PresetGraphAdapter`.
 *
 * Rendered at 1:1 against the measured container width (no viewBox
 * down-scaling) so labels land at true `text-base` size. Each node is a
 * real HTML card (`<foreignObject>`) sized to ITS role label — no fixed
 * width, so labels never overflow — on an opaque background that always
 * covers the lines beneath. Verbose detail (template name, description)
 * lives in the host's member sidebar; the node carries just the role, so
 * the schematic stays compact. Edges clip to each node's border (arrow
 * lands on the box) and reveal their event label (`text-base`) when their
 * path is focused via node/roster hover. Sequential (solid, team colour)
 * vs feedback (dashed, warning tone) are distinguished + a legend.
 */

interface PresetConnectionGraphProps {
  preset: TeamPreset;
  /** Roles currently included; deselected nodes/edges fade. Omit = all on. */
  selectedRoles?: Set<string>;
  /** Click a node to toggle its membership (makes the graph the selection surface). */
  onToggleRole?: (role: string) => void;
  /** Externally-driven focus (e.g. roster hover). */
  focusRole?: string | null;
  /** Reports the node the user is hovering in the graph (so the host can mirror focus). */
  onFocusRoleChange?: (role: string | null) => void;
  /** SVG pixel height; width is measured from the container. Default 440. */
  height?: number;
  /** Hide the sequential/feedback legend (when the host renders its own). */
  hideLegend?: boolean;
  className?: string;
}

const NODE_H = 48;

/** Width fitted to the role label — uppercase text-base, ~11px/char, plus
 *  room for the accent dot + horizontal padding. Clamped to keep extremes sane. */
function nodeWidth(role: string): number {
  return Math.max(104, Math.min(248, Math.round(role.length * 11 + 44)));
}

function borderPoint(cx: number, cy: number, towardX: number, towardY: number, hw: number, hh: number) {
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

export function PresetConnectionGraph({
  preset,
  selectedRoles,
  onToggleRole,
  focusRole = null,
  onFocusRoleChange,
  height = 440,
  hideLegend = false,
  className = '',
}: PresetConnectionGraphProps) {
  const { t } = useTranslation();
  const rawId = useId();
  const markerId = `pcg-arrow-${rawId.replace(/:/g, '')}`;
  const markerFeedbackId = `${markerId}-fb`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hovered, setHovered] = useState<string | null>(null);

  const teamColor = preset.team.color ?? preset.color;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setFocus = (role: string | null) => {
    setHovered(role);
    onFocusRoleChange?.(role);
  };

  const layout = useMemo(() => {
    if (preset.members.length === 0) return null;
    const widths = new Map(preset.members.map((m) => [m.role, nodeWidth(m.role)]));
    const maxW = Math.max(...widths.values());
    const padX = maxW / 2 + 24;
    const padY = NODE_H / 2 + 30;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const m of preset.members) {
      minX = Math.min(minX, m.x); maxX = Math.max(maxX, m.x);
      minY = Math.min(minY, m.y); maxY = Math.max(maxY, m.y);
    }
    const srcW = Math.max(1, maxX - minX);
    const srcH = Math.max(1, maxY - minY);
    const tW = Math.max(1, width - padX * 2);
    const tH = Math.max(1, height - padY * 2);
    const project = (px: number, py: number) => ({
      x: padX + (px - minX) * (tW / srcW),
      y: padY + (py - minY) * (tH / srcH),
    });

    const nodesByRole = new Map(
      preset.members.map((m) => {
        const { x, y } = project(m.x, m.y);
        return [m.role, { role: m.role, x, y, w: widths.get(m.role)! }];
      }),
    );
    const edges = preset.connections
      .map((c, i) => {
        const from = nodesByRole.get(c.from);
        const to = nodesByRole.get(c.to);
        if (!from || !to) return null;
        const start = borderPoint(from.x, from.y, to.x, to.y, from.w / 2, NODE_H / 2);
        const end = borderPoint(to.x, to.y, from.x, from.y, to.w / 2, NODE_H / 2);
        return {
          id: `${c.from}->${c.to}-${i}`,
          from: c.from, to: c.to, start, end,
          isFeedback: c.connection_type === 'feedback',
          label: c.label,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    return { nodes: Array.from(nodesByRole.values()), edges };
  }, [preset, width, height]);

  if (!layout) return <div ref={wrapRef} className={className} style={{ height }} />;

  const isActive = (role: string) => !selectedRoles || selectedRoles.has(role);
  const focus = hovered ?? focusRole;
  const edgeFocused = (e: { from: string; to: string }) => !focus || e.from === focus || e.to === focus;

  return (
    <div ref={wrapRef} className={className}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t.templates.presets.preview_graph_aria}>
        <defs>
          <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={colorWithAlpha(teamColor, 0.9)} />
          </marker>
          <marker id={markerFeedbackId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-status-warning" />
          </marker>
        </defs>

        {/* Edges (drawn first → nodes paint on top) */}
        {layout.edges.map((e) => {
          const active = isActive(e.from) && isActive(e.to);
          const focused = edgeFocused(e);
          const dx = e.end.x - e.start.x;
          const dy = e.end.y - e.start.y;
          const bow = e.isFeedback ? -0.16 : 0.1;
          const mx = (e.start.x + e.end.x) / 2 - dy * bow;
          const my = (e.start.y + e.end.y) / 2 + dx * bow;
          const opacity = (active ? 1 : 0.25) * (focused ? 1 : 0.16);
          return (
            <path
              key={e.id}
              d={`M ${e.start.x} ${e.start.y} Q ${mx} ${my} ${e.end.x} ${e.end.y}`}
              fill="none"
              stroke={e.isFeedback ? undefined : colorWithAlpha(teamColor, 0.8)}
              className={`transition-opacity duration-200 ${e.isFeedback ? 'stroke-status-warning' : ''}`}
              strokeWidth={focus && focused ? 3 : 2}
              strokeDasharray={e.isFeedback ? '8 6' : undefined}
              markerEnd={`url(#${e.isFeedback ? markerFeedbackId : markerId})`}
              opacity={opacity}
            />
          );
        })}

        {/* Edge labels — text-base chips, shown when their path is focused */}
        {focus && layout.edges.filter((e) => edgeFocused(e) && e.label && isActive(e.from) && isActive(e.to)).map((e) => {
          const dx = e.end.x - e.start.x;
          const dy = e.end.y - e.start.y;
          const bow = e.isFeedback ? -0.16 : 0.1;
          const cx = (e.start.x + e.end.x) / 2 - dy * bow;
          const cy = (e.start.y + e.end.y) / 2 + dx * bow;
          const lx = 0.25 * e.start.x + 0.5 * cx + 0.25 * e.end.x;
          const ly = 0.25 * e.start.y + 0.5 * cy + 0.25 * e.end.y;
          const LW = 248;
          return (
            <foreignObject key={`lbl-${e.id}`} x={lx - LW / 2} y={ly - 26} width={LW} height={70} style={{ overflow: 'visible', pointerEvents: 'none' }}>
              <div className="flex justify-center">
                <span className="inline-block rounded-input border border-primary/15 bg-background/95 px-2 py-1 typo-body-lg text-foreground text-center shadow-elevation-1">
                  {e.label}
                </span>
              </div>
            </foreignObject>
          );
        })}

        {/* Nodes — opaque, auto-width HTML cards, painted last (always on top of the lines) */}
        {layout.nodes.map((n) => {
          const active = isActive(n.role);
          const isFocused = focus === n.role;
          const clickable = !!onToggleRole;
          return (
            <foreignObject key={n.role} x={n.x - n.w / 2} y={n.y - NODE_H / 2} width={n.w} height={NODE_H} style={{ overflow: 'visible' }}>
              <div
                role={clickable ? 'button' : undefined}
                aria-pressed={clickable ? active : undefined}
                onClick={clickable ? () => onToggleRole!(n.role) : undefined}
                onMouseEnter={() => setFocus(n.role)}
                onMouseLeave={() => setFocus(null)}
                data-testid={`preset-graph-node-${n.role}`}
                className={`h-full w-full rounded-card border bg-background flex items-center gap-2 px-3 transition-shadow duration-200 ${clickable ? 'cursor-pointer' : ''}`}
                style={{
                  borderColor: colorWithAlpha(teamColor, active ? 0.85 : 0.45),
                  borderStyle: active ? 'solid' : 'dashed',
                  borderWidth: active ? 1.5 : 1.25,
                  boxShadow: isFocused
                    ? `inset 3px 0 0 ${colorWithAlpha(teamColor, 0.9)}, 0 0 0 2px ${colorWithAlpha(teamColor, 0.4)}`
                    : active ? `inset 3px 0 0 ${colorWithAlpha(teamColor, 0.9)}` : undefined,
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: colorWithAlpha(teamColor, active ? 1 : 0.5) }} />
                <span
                  className="typo-body-lg font-semibold uppercase tracking-wider whitespace-nowrap leading-none"
                  style={{ color: active ? teamColor : undefined }}
                >
                  {n.role}
                </span>
              </div>
            </foreignObject>
          );
        })}
      </svg>

      {!hideLegend && (
        <div className="flex items-center gap-4 mt-1 px-1">
          <span className="inline-flex items-center gap-1.5 typo-caption text-foreground">
            <svg width="24" height="8" aria-hidden>
              <line x1="0" y1="4" x2="24" y2="4" stroke={colorWithAlpha(teamColor, 0.85)} strokeWidth="2" />
            </svg>
            {t.templates.presets.graph_legend_sequential}
          </span>
          <span className="inline-flex items-center gap-1.5 typo-caption text-foreground">
            <svg width="24" height="8" aria-hidden>
              <line x1="0" y1="4" x2="24" y2="4" className="stroke-status-warning" strokeWidth="2" strokeDasharray="6 4" />
            </svg>
            {t.templates.presets.graph_legend_feedback}
          </span>
        </div>
      )}
    </div>
  );
}
