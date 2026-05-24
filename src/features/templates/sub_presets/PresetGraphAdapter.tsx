import { useMemo } from 'react';
import { Users } from 'lucide-react';
import type { TeamPreset } from '@/lib/bindings/TeamPreset';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';

/**
 * Read-only fit-to-rect SVG mini-canvas for a TeamPreset manifest.
 *
 * Adapted from the cycle-18 `TeamGraphPreview` (which takes real
 * `PersonaTeamMember[]` + `PersonaTeamConnection[]` rows) — those don't
 * exist before adoption, so this variant projects the manifest's
 * declared `(x, y)` + role labels directly.
 *
 * Why a separate component instead of synthetic placeholder rows: a
 * synthesized PersonaTeamMember/Connection adapter would leak preview-
 * only ids into the shared component's API surface, force the cycle-18
 * preview to handle "missing persona" rendering paths it doesn't need,
 * and tie the manifest's evolution to the runtime row schema. Kept
 * single-purpose by duplicating the ~30 lines of layout math.
 */

interface PresetGraphAdapterProps {
  preset: TeamPreset;
}

const PREVIEW_WIDTH = 460;
const PREVIEW_HEIGHT = 180;
const NODE_RADIUS = 12;
const PADDING = 28;

export function PresetGraphAdapter({ preset }: PresetGraphAdapterProps) {
  const { t } = useTranslation();

  const layout = useMemo(() => {
    if (preset.members.length === 0) return null;

    // The manifest's (x, y) coordinates live in canvas space (set by the
    // author in the team editor or by hand in the JSON). Compute the
    // bounding box and project into the preview viewport.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const m of preset.members) {
      minX = Math.min(minX, m.x);
      maxX = Math.max(maxX, m.x);
      minY = Math.min(minY, m.y);
      maxY = Math.max(maxY, m.y);
    }
    const srcW = Math.max(1, maxX - minX);
    const srcH = Math.max(1, maxY - minY);
    const targetW = PREVIEW_WIDTH - PADDING * 2;
    const targetH = PREVIEW_HEIGHT - PADDING * 2;
    const scale = Math.min(targetW / srcW, targetH / srcH);
    const scaledW = srcW * scale;
    const scaledH = srcH * scale;
    const offsetX = (PREVIEW_WIDTH - scaledW) / 2 - minX * scale;
    const offsetY = (PREVIEW_HEIGHT - scaledH) / 2 - minY * scale;
    const project = (px: number, py: number) => ({
      x: px * scale + offsetX,
      y: py * scale + offsetY,
    });

    const nodesByRole = new Map(
      preset.members.map((m) => {
        const { x, y } = project(m.x, m.y);
        return [m.role, { role: m.role, templateId: m.template_id, x, y }];
      }),
    );
    const edges = preset.connections
      .map((c) => {
        const from = nodesByRole.get(c.from);
        const to = nodesByRole.get(c.to);
        if (!from || !to) return null;
        return {
          id: `${c.from}->${c.to}`,
          from: { x: from.x, y: from.y },
          to: { x: to.x, y: to.y },
          isFeedback: c.connection_type === 'feedback',
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    return {
      nodes: Array.from(nodesByRole.values()),
      edges,
    };
  }, [preset]);

  if (!layout) return null;

  const teamColor = preset.team.color ?? preset.color;

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <Users className="w-3.5 h-3.5 text-foreground/60" />
        <h3 className="typo-label uppercase tracking-wider text-foreground/70">
          {t.templates.presets.preview_graph_heading}
        </h3>
      </div>
      <div className="rounded-card border border-primary/10 bg-secondary/15 overflow-hidden">
        <svg
          viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full block"
          style={{ height: PREVIEW_HEIGHT }}
          aria-label={t.templates.presets.preview_graph_aria}
        >
          <defs>
            <marker
              id="preset-graph-arrow"
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
              markerEnd="url(#preset-graph-arrow)"
            />
          ))}

          {layout.nodes.map((n) => (
            <g key={n.role}>
              <title>{`${n.role} — ${n.templateId}`}</title>
              <circle
                cx={n.x}
                cy={n.y}
                r={NODE_RADIUS}
                fill={colorWithAlpha(teamColor, 0.35)}
                stroke={colorWithAlpha(teamColor, 0.9)}
                strokeWidth={1.5}
              />
              <text
                x={n.x}
                y={n.y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ fontSize: '9px', fontWeight: 600, fill: teamColor }}
              >
                {n.role.slice(0, 2).toUpperCase()}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}
