import { useState } from 'react';
import { CheckSquare, Settings2, Square, Users, Workflow } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { PresetConnectionGraph } from './PresetConnectionGraph';
import { PresetCustomizePanel, PresetStatusBadge } from './presetStudioShared';
import type { PresetVariantProps } from './types';

/**
 * BLUEPRINT — the connection graph is the hero AND a selection surface,
 * paired with a member sidebar.
 *
 * Left: a single uniform-width column of member cards (role + full
 * template name + description + config count); hovering one focuses it in
 * the schematic, clicking includes / excludes it. Right: an engineering
 * schematic of the team on draughting paper — tap a node to toggle it,
 * hover to reveal the event each edge carries. The graph nodes stay
 * compact (role only); the verbose detail lives in the sidebar, so node
 * labels never overflow.
 */
export function PresetProcessBlueprint({ preset, a, customizing }: PresetVariantProps) {
  const { t, tx } = useTranslation();
  const teamColor = preset.team.color ?? preset.color;
  const preview = a.stage === 'preview';
  const [focusRole, setFocusRole] = useState<string | null>(null);

  // Faint draughting grid keyed off the team colour — static decoration.
  const gridStyle: React.CSSProperties = {
    backgroundImage: `linear-gradient(${colorWithAlpha(teamColor, 0.07)} 1px, transparent 1px), linear-gradient(90deg, ${colorWithAlpha(teamColor, 0.07)} 1px, transparent 1px)`,
    backgroundSize: '28px 28px',
  };

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* Left — member sidebar (one uniform-width column) */}
      <aside className="flex-shrink-0 w-[300px] flex flex-col border-r border-primary/10 bg-secondary/10">
        <div className="flex-shrink-0 px-3 pt-3 pb-1.5 flex items-center justify-between gap-2">
          <span className="px-1 typo-label uppercase tracking-wider text-foreground inline-flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" />
            {t.templates.presets.preview_members_heading}
          </span>
          <span className="typo-caption text-foreground">
            {preview ? `${a.selectedRoles.size}/${preset.members.length}` : preset.members.length}
          </span>
        </div>
        {preview && (
          <p className="flex-shrink-0 px-4 pb-2 typo-caption text-foreground">
            {t.templates.presets.preview_members_select_hint}
          </p>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-1.5">
          {a.rows.map((row) => {
            const meta = a.schemaByRole.get(row.role);
            const selected = a.selectedRoles.has(row.role);
            const qCount = a.schema?.members.find((m) => m.role === row.role)?.questions.length ?? 0;
            const CardTag = preview ? 'button' : 'div';
            return (
              <CardTag
                key={row.role}
                type={preview ? 'button' : undefined}
                onClick={preview ? () => a.toggleMemberSelection(row.role) : undefined}
                onMouseEnter={() => setFocusRole(row.role)}
                onMouseLeave={() => setFocusRole(null)}
                aria-pressed={preview ? selected : undefined}
                data-testid={`preset-member-${row.role}`}
                data-status={row.status}
                className={`w-full text-left rounded-card border px-3 py-2.5 transition-colors ${
                  preview
                    ? selected
                      ? 'border-primary/25 bg-secondary/35 hover:border-primary/40'
                      : 'border-primary/8 bg-secondary/10 hover:bg-secondary/20'
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
                    className="typo-body font-semibold uppercase tracking-wider truncate"
                    style={{ color: selected || !preview ? teamColor : undefined }}
                  >
                    {row.role}
                  </span>
                  {!preview && <span className="ml-auto"><PresetStatusBadge row={row} /></span>}
                  {preview && qCount > 0 && (
                    <span className="ml-auto inline-flex items-center gap-1 typo-caption text-foreground" title={tx(t.templates.presets.questionnaire_member_summary_default, { count: qCount })}>
                      <Settings2 className="w-3 h-3" />
                      {qCount}
                    </span>
                  )}
                </div>
                <div className="typo-body text-foreground/90 mt-1 leading-snug">{meta?.name ?? row.templateId}</div>
                {meta?.description && (
                  <div className="typo-caption text-foreground mt-0.5 line-clamp-2 leading-snug">{meta.description}</div>
                )}
              </CardTag>
            );
          })}
        </div>
      </aside>

      {/* Right — schematic + customize */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
        <div className="flex items-center gap-2">
          <Workflow className="w-4 h-4" style={{ color: teamColor }} />
          <h3 className="typo-label uppercase tracking-wider text-foreground">
            {t.pipeline.preset_blueprint_heading}
          </h3>
          {preview && (
            <span className="typo-caption text-foreground ml-auto">{t.pipeline.preset_blueprint_hint}</span>
          )}
        </div>

        {/* Draughting frame */}
        <div className="relative rounded-card border overflow-hidden" style={{ borderColor: colorWithAlpha(teamColor, 0.3) }}>
          <div className="absolute inset-0 pointer-events-none" style={gridStyle} />
          {(['left-3 top-3', 'right-3 top-3', 'left-3 bottom-3', 'right-3 bottom-3'] as const).map((pos) => (
            <span key={pos} className={`absolute ${pos} w-2.5 h-2.5 border-foreground/30`} style={{ borderTopWidth: 1, borderLeftWidth: 1 }} />
          ))}
          <div className="relative px-4 py-4">
            <PresetConnectionGraph
              preset={preset}
              selectedRoles={a.selectedRoles}
              onToggleRole={preview ? a.toggleMemberSelection : undefined}
              focusRole={focusRole}
              onFocusRoleChange={setFocusRole}
              height={440}
            />
          </div>
        </div>

        <PresetCustomizePanel a={a} customizing={customizing} />
      </div>
    </div>
  );
}
