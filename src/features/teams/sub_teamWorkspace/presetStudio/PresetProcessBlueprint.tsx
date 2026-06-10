import { CheckSquare, Square, Workflow } from 'lucide-react';
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
 * BLUEPRINT — the connection graph is the hero AND the selection surface.
 *
 * Metaphor: an engineering schematic of the team. The wired graph fills
 * a draughting-paper frame (faint grid, corner ticks); tapping a node
 * toggles that member in or out and its edges dim with it. A chip rail
 * under the drawing mirrors the selection for keyboard/obvious access
 * and flips to live status badges during adoption. Differs from baseline
 * (which buries a small graph above a checklist) by making "understand
 * the wiring" and "choose the members" the same gesture.
 */
export function PresetProcessBlueprint({ preset, a, customizing }: PresetVariantProps) {
  const { t } = useTranslation();
  const teamColor = preset.team.color ?? preset.color;
  const labelByRole = useLabelByRole(a);
  const preview = a.stage === 'preview';

  // Faint draughting grid keyed off the team colour — static decoration.
  const gridStyle: React.CSSProperties = {
    backgroundImage: `linear-gradient(${colorWithAlpha(teamColor, 0.07)} 1px, transparent 1px), linear-gradient(90deg, ${colorWithAlpha(teamColor, 0.07)} 1px, transparent 1px)`,
    backgroundSize: '28px 28px',
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">
      <div className="flex items-center gap-2">
        <Workflow className="w-4 h-4" style={{ color: teamColor }} />
        <h3 className="typo-label uppercase tracking-wider text-foreground">
          {t.pipeline.preset_blueprint_heading}
        </h3>
        {preview && (
          <span className="typo-caption text-foreground ml-auto">
            {t.pipeline.preset_blueprint_hint}
          </span>
        )}
      </div>

      {/* Draughting frame */}
      <div className="relative rounded-card border border-primary/15 overflow-hidden" style={{ borderColor: colorWithAlpha(teamColor, 0.3) }}>
        <div className="absolute inset-0 pointer-events-none" style={gridStyle} />
        {/* corner ticks */}
        {(['left-3 top-3', 'right-3 top-3', 'left-3 bottom-3', 'right-3 bottom-3'] as const).map((pos) => (
          <span key={pos} className={`absolute ${pos} w-2.5 h-2.5 border-foreground/30`} style={{ borderTopWidth: 1, borderLeftWidth: 1 }} />
        ))}
        <div className="relative px-4 py-4">
          <PresetConnectionGraph
            preset={preset}
            labelByRole={labelByRole}
            selectedRoles={a.selectedRoles}
            onToggleRole={preview ? a.toggleMemberSelection : undefined}
            height={400}
          />
        </div>
      </div>

      {preset.group && (
        <section className="rounded-card border border-primary/10 bg-secondary/15 px-3 py-2 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: preset.group.color }} />
          <span className="typo-body text-foreground/90 truncate">
            {t.templates.presets.preview_group_binding.replace('{name}', preset.group.name)}
          </span>
        </section>
      )}

      <PresetCustomizePanel a={a} customizing={customizing} />

      {/* Chip rail — mirror of the graph selection / live status. */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="typo-label uppercase tracking-wider text-foreground">
            {t.templates.presets.preview_members_heading}
          </h3>
          <span className="typo-label text-foreground">
            {preview ? `(${a.selectedRoles.size}/${preset.members.length})` : `(${preset.members.length})`}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {a.rows.map((row) => {
            const meta = a.schemaByRole.get(row.role);
            const selected = a.selectedRoles.has(row.role);
            const ChipTag = preview ? 'button' : 'div';
            return (
              <ChipTag
                key={row.role}
                type={preview ? 'button' : undefined}
                onClick={preview ? () => a.toggleMemberSelection(row.role) : undefined}
                aria-pressed={preview ? selected : undefined}
                data-testid={`preset-chip-${row.role}`}
                data-status={row.status}
                className={`inline-flex items-center gap-2 pl-2 pr-3 py-2 rounded-card border transition-colors ${
                  preview
                    ? selected
                      ? 'bg-secondary/30 border-primary/20 hover:border-primary/40'
                      : 'bg-secondary/10 border-primary/8 opacity-55 hover:opacity-80'
                    : 'bg-secondary/25 border-primary/10'
                }`}
              >
                {preview && (
                  selected ? (
                    <CheckSquare className="w-4 h-4 flex-shrink-0" style={{ color: teamColor }} />
                  ) : (
                    <Square className="w-4 h-4 flex-shrink-0 text-foreground" />
                  )
                )}
                <span className="text-left">
                  <span
                    className="block typo-caption font-semibold uppercase tracking-wider"
                    style={{ color: selected || !preview ? teamColor : undefined }}
                  >
                    {row.role}
                  </span>
                  <span className="block typo-caption text-foreground">{meta?.name ?? row.templateId}</span>
                </span>
                {!preview && <span className="ml-1"><PresetStatusBadge row={row} /></span>}
              </ChipTag>
            );
          })}
        </div>
      </section>
    </div>
  );
}
