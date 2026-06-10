import { useMemo } from 'react';
import { ArrowRight, CheckSquare, CornerDownLeft, Square, GitBranch } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { PresetCustomizePanel, PresetStatusBadge } from './presetStudioShared';
import type { PresetVariantProps } from './types';

/**
 * PIPELINE — the team as a left-to-right value line.
 *
 * Metaphor: an assembly line / value stream. Members become stations
 * ordered by their authored x-position; the forward handoff between two
 * adjacent stations renders as a labelled connector chip carrying the
 * actual event that flows (`architecture.analysis.completed`), so the
 * connection isn't an abstract arrow — it's the work product moving
 * down the line. Feedback edges (return paths) are surfaced as a
 * distinct row beneath. Selection = include/exclude a station; during
 * adoption each station shows its live badge. Differs from baseline and
 * blueprint by making *sequence and what-flows-between* the mental model.
 */
export function PresetProcessPipeline({ preset, a, customizing }: PresetVariantProps) {
  const { t } = useTranslation();
  const teamColor = preset.team.color ?? preset.color;
  const preview = a.stage === 'preview';

  const { ordered, connectorFor, feedbackEdges } = useMemo(() => {
    const ordered = [...preset.members].sort((m1, m2) => m1.x - m2.x || m1.y - m2.y);
    const forward = preset.connections.filter((c) => c.connection_type !== 'feedback');
    const feedbackEdges = preset.connections.filter((c) => c.connection_type === 'feedback');
    const connectorFor = (fromRole: string, toRole: string) =>
      forward.find((c) => c.from === fromRole && c.to === toRole) ?? null;
    return { ordered, connectorFor, feedbackEdges };
  }, [preset]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
      <div className="flex items-center gap-2">
        <GitBranch className="w-4 h-4" style={{ color: teamColor }} />
        <h3 className="typo-label uppercase tracking-wider text-foreground">
          {t.pipeline.preset_pipeline_heading}
        </h3>
        {preview && (
          <span className="typo-caption text-foreground ml-auto">
            {t.templates.presets.preview_members_select_hint}
          </span>
        )}
      </div>

      {/* The line */}
      <div className="overflow-x-auto pb-2">
        <div className="flex items-stretch gap-0 min-w-min">
          {ordered.map((m, i) => {
            const row = a.rows.find((r) => r.role === m.role);
            const meta = a.schemaByRole.get(m.role);
            const selected = a.selectedRoles.has(m.role);
            const StationTag = preview ? 'button' : 'div';
            const next = ordered[i + 1];
            const conn = next ? connectorFor(m.role, next.role) : null;
            return (
              <div key={m.role} className="flex items-stretch">
                <StationTag
                  type={preview ? 'button' : undefined}
                  onClick={preview ? () => a.toggleMemberSelection(m.role) : undefined}
                  aria-pressed={preview ? selected : undefined}
                  data-testid={`preset-station-${m.role}`}
                  data-status={row?.status}
                  className={`relative w-[208px] flex-shrink-0 text-left rounded-card border p-3 transition-colors ${
                    preview
                      ? selected
                        ? 'bg-secondary/30 border-primary/20 hover:border-primary/40'
                        : 'bg-secondary/10 border-primary/8 opacity-55 hover:opacity-80'
                      : 'bg-secondary/25 border-primary/10'
                  }`}
                  style={selected || !preview ? { borderTopColor: colorWithAlpha(teamColor, 0.6), borderTopWidth: 2 } : undefined}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="inline-flex items-center justify-center w-5 h-5 rounded-full typo-caption font-bold flex-shrink-0"
                      style={{ backgroundColor: colorWithAlpha(teamColor, 0.18), color: teamColor }}
                    >
                      {i + 1}
                    </span>
                    <span
                      className="typo-caption font-semibold uppercase tracking-wider truncate"
                      style={{ color: selected || !preview ? teamColor : undefined }}
                    >
                      {m.role}
                    </span>
                    {preview && (
                      <span className="ml-auto">
                        {selected ? (
                          <CheckSquare className="w-4 h-4" style={{ color: teamColor }} />
                        ) : (
                          <Square className="w-4 h-4 text-foreground" />
                        )}
                      </span>
                    )}
                  </div>
                  <p className="typo-body text-foreground/90 truncate">{meta?.name ?? m.template_id}</p>
                  {meta?.description && (
                    <p className="typo-caption text-foreground mt-1 line-clamp-2">{meta.description}</p>
                  )}
                  {!preview && row && (
                    <div className="mt-2 pt-2 border-t border-primary/10">
                      <PresetStatusBadge row={row} />
                    </div>
                  )}
                </StationTag>

                {/* Connector to the next station */}
                {next && (
                  <div className="flex flex-col items-center justify-center px-2 w-[150px] flex-shrink-0">
                    <ArrowRight className="w-4 h-4 flex-shrink-0" style={{ color: colorWithAlpha(teamColor, 0.8) }} />
                    {conn?.label && (
                      <span className="mt-1 typo-caption text-foreground text-center leading-tight line-clamp-3">
                        {conn.label}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Feedback / return paths */}
      {feedbackEdges.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <CornerDownLeft className="w-3.5 h-3.5 text-status-warning" />
            <h4 className="typo-label uppercase tracking-wider text-foreground">
              {t.pipeline.preset_pipeline_feedback_heading}
            </h4>
          </div>
          <div className="flex flex-wrap gap-2">
            {feedbackEdges.map((e, i) => (
              <span
                key={`${e.from}-${e.to}-${i}`}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-card border border-status-warning/25 bg-status-warning/5"
              >
                <span className="typo-caption font-semibold uppercase tracking-wider text-foreground">{e.to}</span>
                <CornerDownLeft className="w-3 h-3 text-status-warning" />
                <span className="typo-caption font-semibold uppercase tracking-wider text-foreground">{e.from}</span>
                {e.label && <span className="typo-caption text-foreground">· {e.label}</span>}
              </span>
            ))}
          </div>
        </section>
      )}

      {preset.group && (
        <section className="rounded-card border border-primary/10 bg-secondary/15 px-3 py-2 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: preset.group.color }} />
          <span className="typo-body text-foreground/90 truncate">
            {t.templates.presets.preview_group_binding.replace('{name}', preset.group.name)}
          </span>
        </section>
      )}

      <PresetCustomizePanel a={a} customizing={customizing} />
    </div>
  );
}
