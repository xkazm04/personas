import { useMemo, useState } from 'react';
import { ArrowRight, ArrowLeft, CheckSquare, Square, Settings2, Users } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { PresetConnectionGraph } from './PresetConnectionGraph';
import {
  PresetCustomizePanel,
  PresetStatusBadge,
  useLabelByRole,
} from './presetStudioShared';
import type { PresetVariantProps } from './types';

/**
 * SPLIT STUDIO — roster on the left, reactive graph + member detail on
 * the right. Deliberately echoes `TeamStudioSplitVariant` so the preset
 * flow feels native to the Teams section it now lives in.
 *
 * Hovering a roster row focuses that member in the graph (its edges
 * brighten, the rest dim) and fills the detail panel with a plain-
 * language read of its wiring — "receives from X / hands off to Y" —
 * which is the most legible answer to "what do these connections mean?".
 * Clicking toggles inclusion. Differs from the others by pairing a dense
 * roster with a live, inspected graph rather than one hero surface.
 */
export function PresetProcessSplit({ preset, a, customizing }: PresetVariantProps) {
  const { t, tx } = useTranslation();
  const teamColor = preset.team.color ?? preset.color;
  const labelByRole = useLabelByRole(a);
  const preview = a.stage === 'preview';
  const [focusRole, setFocusRole] = useState<string | null>(null);

  const detail = useMemo(() => {
    if (!focusRole) return null;
    const meta = a.schemaByRole.get(focusRole);
    const incoming = preset.connections.filter((c) => c.to === focusRole);
    const outgoing = preset.connections.filter((c) => c.from === focusRole);
    const questionCount = a.schema?.members.find((m) => m.role === focusRole)?.questions.length ?? 0;
    return { meta, incoming, outgoing, questionCount };
  }, [focusRole, a.schemaByRole, a.schema, preset.connections]);

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* Left — roster */}
      <div className="flex-shrink-0 w-[330px] flex flex-col border-r border-primary/10 bg-secondary/10">
        <div className="flex-shrink-0 px-3 pt-3 pb-1.5 flex items-center justify-between gap-2">
          <p className="px-1 typo-label uppercase tracking-wider text-foreground inline-flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" />
            {t.templates.presets.preview_members_heading}
          </p>
          <span className="typo-caption text-foreground">
            {preview ? `${a.selectedRoles.size}/${preset.members.length}` : preset.members.length}
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-1">
          {a.rows.map((row) => {
            const meta = a.schemaByRole.get(row.role);
            const selected = a.selectedRoles.has(row.role);
            const RowTag = preview ? 'button' : 'div';
            const qCount = a.schema?.members.find((m) => m.role === row.role)?.questions.length ?? 0;
            return (
              <RowTag
                key={row.role}
                type={preview ? 'button' : undefined}
                onClick={preview ? () => a.toggleMemberSelection(row.role) : undefined}
                onMouseEnter={() => setFocusRole(row.role)}
                onMouseLeave={() => setFocusRole(null)}
                aria-pressed={preview ? selected : undefined}
                data-testid={`preset-roster-${row.role}`}
                data-status={row.status}
                className={`text-left rounded-card border px-2.5 py-2 transition-colors ${
                  preview
                    ? selected
                      ? 'border-primary/25 bg-secondary/35'
                      : 'border-primary/8 bg-secondary/10 opacity-60 hover:opacity-90'
                    : 'border-primary/10 bg-secondary/25'
                } ${focusRole === row.role ? 'ring-1 ring-primary/30' : ''}`}
              >
                <div className="flex items-center gap-2">
                  {preview && (
                    selected ? (
                      <CheckSquare className="w-4 h-4 flex-shrink-0" style={{ color: teamColor }} />
                    ) : (
                      <Square className="w-4 h-4 flex-shrink-0 text-foreground" />
                    )
                  )}
                  <span
                    className="typo-caption font-semibold uppercase tracking-wider truncate"
                    style={{ color: selected || !preview ? teamColor : undefined }}
                  >
                    {row.role}
                  </span>
                  {!preview && <span className="ml-auto"><PresetStatusBadge row={row} /></span>}
                  {preview && qCount > 0 && (
                    <span className="ml-auto inline-flex items-center gap-1 typo-caption text-foreground">
                      <Settings2 className="w-3 h-3" />
                      {qCount}
                    </span>
                  )}
                </div>
                <div className="typo-body text-foreground/90 truncate mt-0.5">{meta?.name ?? row.templateId}</div>
                {meta?.description && (
                  <div className="typo-caption text-foreground truncate">{meta.description}</div>
                )}
              </RowTag>
            );
          })}
        </div>

        {preset.group && (
          <div className="flex-shrink-0 border-t border-primary/10 px-3 py-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: preset.group.color }} />
            <span className="typo-caption text-foreground/90 truncate">
              {tx(t.templates.presets.preview_group_binding, { name: preset.group.name })}
            </span>
          </div>
        )}
      </div>

      {/* Right — reactive graph + detail */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-4">
        <div className="rounded-card border border-primary/10 bg-secondary/15 px-3 py-3">
          <PresetConnectionGraph
            preset={preset}
            labelByRole={labelByRole}
            selectedRoles={a.selectedRoles}
            focusRole={focusRole}
            height={300}
          />
        </div>

        <PresetCustomizePanel a={a} customizing={customizing} />

        {/* Detail panel for the focused member */}
        <div className="rounded-card border border-primary/10 bg-secondary/10 px-4 py-3 min-h-[120px]">
          {detail ? (
            <>
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="typo-caption font-semibold uppercase tracking-wider"
                  style={{ color: teamColor }}
                >
                  {focusRole}
                </span>
                <span className="typo-body font-medium text-foreground/90">{detail.meta?.name}</span>
              </div>
              {detail.meta?.description && (
                <p className="typo-body text-foreground mb-2.5 leading-relaxed">{detail.meta.description}</p>
              )}
              <div className="space-y-1">
                {detail.incoming.map((c, i) => (
                  <div key={`in-${i}`} className="flex items-start gap-2 typo-caption text-foreground">
                    <ArrowLeft className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: colorWithAlpha(teamColor, 0.8) }} />
                    <span>
                      {tx(t.pipeline.preset_split_receives_from, { role: c.from })}
                      {c.label ? ` — ${c.label}` : ''}
                    </span>
                  </div>
                ))}
                {detail.outgoing.map((c, i) => (
                  <div key={`out-${i}`} className="flex items-start gap-2 typo-caption text-foreground">
                    <ArrowRight className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: colorWithAlpha(teamColor, 0.8) }} />
                    <span>
                      {tx(t.pipeline.preset_split_hands_off_to, { role: c.to })}
                      {c.label ? ` — ${c.label}` : ''}
                    </span>
                  </div>
                ))}
                {detail.incoming.length === 0 && detail.outgoing.length === 0 && (
                  <p className="typo-caption text-foreground">{t.pipeline.preset_split_no_connections}</p>
                )}
              </div>
            </>
          ) : (
            <p className="typo-body text-foreground h-full flex items-center justify-center">
              {t.pipeline.preset_split_hover_hint}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
