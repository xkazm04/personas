import { CheckSquare, Square, Users } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PresetConnectionGraph } from './PresetConnectionGraph';
import {
  PresetCustomizePanel,
  PresetFooterHint,
  PresetStatusBadge,
  useLabelByRole,
} from './presetStudioShared';
import type { PresetVariantProps } from './types';

/**
 * BASELINE — the ported modal layout, given room to breathe in app
 * content. Single centred column: connection graph, optional group
 * binding, customize panel, then the selectable member checklist. Kept
 * as the A/B reference for the three directional variants; deliberately
 * the least re-imagined of the four.
 */
export function PresetProcessBaseline({ preset, a, customizing }: PresetVariantProps) {
  const { t } = useTranslation();
  const teamColor = preset.team.color ?? preset.color;
  const labelByRole = useLabelByRole(a);

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
      <section>
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-3.5 h-3.5 text-foreground" />
          <h3 className="typo-label uppercase tracking-wider text-foreground">
            {t.templates.presets.preview_graph_heading}
          </h3>
        </div>
        <div className="rounded-card border border-primary/10 bg-secondary/15 px-2 py-2">
          <PresetConnectionGraph preset={preset} labelByRole={labelByRole} selectedRoles={a.selectedRoles} height={300} />
        </div>
      </section>

      {preset.group && (
        <section className="rounded-card border border-primary/10 bg-secondary/15 px-3 py-2 flex items-center gap-2">
          <Users className="w-3.5 h-3.5 flex-shrink-0" style={{ color: preset.group.color }} />
          <span className="typo-body text-foreground/90 truncate">
            {t.templates.presets.preview_group_binding.replace('{name}', preset.group.name)}
          </span>
        </section>
      )}

      <PresetCustomizePanel a={a} customizing={customizing} />

      <section>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="typo-label uppercase tracking-wider text-foreground">
            {t.templates.presets.preview_members_heading}
          </h3>
          <span className="typo-label text-foreground">
            {a.stage === 'preview'
              ? `(${a.selectedRoles.size}/${preset.members.length})`
              : `(${preset.members.length})`}
          </span>
          {a.stage === 'preview' && (
            <span className="typo-caption text-foreground ml-auto">
              {t.templates.presets.preview_members_select_hint}
            </span>
          )}
        </div>
        <ul className="space-y-1.5">
          {a.rows.map((row) => {
            const meta = a.schemaByRole.get(row.role);
            const selected = a.selectedRoles.has(row.role);
            const interactive = a.stage === 'preview';
            const RowTag = interactive ? 'button' : 'li';
            return (
              <RowTag
                key={row.role}
                type={interactive ? 'button' : undefined}
                onClick={interactive ? () => a.toggleMemberSelection(row.role) : undefined}
                aria-pressed={interactive ? selected : undefined}
                data-testid={`preset-row-${row.role}`}
                data-status={row.status}
                className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-card border transition-colors ${
                  interactive
                    ? selected
                      ? 'bg-secondary/30 border-primary/15 hover:border-primary/30'
                      : 'bg-secondary/10 border-primary/5 opacity-55 hover:opacity-80'
                    : 'bg-secondary/30 border-primary/10'
                }`}
              >
                {interactive && (
                  selected ? (
                    <CheckSquare className="w-4 h-4 flex-shrink-0" style={{ color: teamColor }} />
                  ) : (
                    <Square className="w-4 h-4 flex-shrink-0 text-foreground" />
                  )
                )}
                <span
                  className="typo-body font-medium min-w-[96px] uppercase tracking-wider text-[11px]"
                  style={{ color: selected || !interactive ? teamColor : undefined }}
                >
                  {row.role}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="typo-body text-foreground/90 block truncate">
                    {meta?.name ?? row.templateId}
                  </span>
                  {meta?.description && (
                    <span className="typo-caption text-foreground block truncate">{meta.description}</span>
                  )}
                </span>
                {!interactive && <PresetStatusBadge row={row} />}
              </RowTag>
            );
          })}
        </ul>
      </section>

      <div className="sr-only">
        {/* Footer hint mirrored for screen readers; the visible footer lives in the host. */}
        <PresetFooterHint a={a} />
      </div>
    </div>
  );
}
