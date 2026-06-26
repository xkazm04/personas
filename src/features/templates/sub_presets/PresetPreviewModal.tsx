import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, CheckSquare, Layers, Loader2, RotateCcw, Settings2, Square, Users, Wrench, X, AlertCircle } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import type { TeamPreset } from '@/lib/bindings/TeamPreset';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { PresetGraphAdapter } from './PresetGraphAdapter';
import {
  PresetQuestionnaireBulkControls,
  PresetQuestionnaireForm,
} from './PresetQuestionnaireForm';
import { usePresetAdoption, type PresetMemberRowState } from './usePresetAdoption';

interface PresetPreviewModalProps {
  open: boolean;
  preset: TeamPreset;
  onClose: () => void;
}

/**
 * Preview + adoption modal for a single TeamPreset manifest — the
 * Templates → Presets surface. The Teams surface renders the same flow
 * in-app via `PresetStudio`; both share the `usePresetAdoption`
 * state machine, so this modal is now a thin layout over that hook.
 *
 * Two states sharing one modal frame: **Preview** (graph + selectable
 * member rows + "Adopt N" CTA) and **Adopting/Done** (live per-member
 * status table driven by `team-preset-adopt-progress`). Partial failures
 * keep the team + landed members and surface failed rows for retry.
 */
export function PresetPreviewModal({ open, preset, onClose }: PresetPreviewModalProps) {
  const { t, tx } = useTranslation();
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  const a = usePresetAdoption(preset, {
    onOpenTeam: useCallback(() => {
      setSidebarSection('personas');
      useSystemStore.getState().setSidebarSection('teams');
      useSystemStore.getState().setTeamsTab('workspace');
      onClose();
    }, [setSidebarSection, onClose]),
  });

  const [customizing, setCustomizing] = useState(false);

  const teamColor = preset.team.color ?? preset.color;

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId="preset-preview-title"
      size="lg"
      portal
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col max-h-[85vh]"
    >
      {/* Header */}
      <div
        data-testid={`preset-preview-modal-${preset.id}`}
        className="px-5 pt-5 pb-3 border-b border-primary/10 flex items-center justify-between"
        style={{ borderLeft: `3px solid ${colorWithAlpha(teamColor, 0.8)}` }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Layers className="w-4 h-4 flex-shrink-0" style={{ color: teamColor }} />
          <div className="min-w-0">
            <h2
              id="preset-preview-title"
              className="typo-heading font-semibold text-foreground/90 truncate"
            >
              {preset.name}
            </h2>
            <p className="typo-caption text-foreground line-clamp-1">{preset.description}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.common.close}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <PresetGraphAdapter preset={preset} />

        {preset.group && (
          <section className="rounded-card border border-primary/10 bg-secondary/15 px-3 py-2 flex items-center gap-2">
            <Users
              className="w-3.5 h-3.5 flex-shrink-0"
              style={{ color: preset.group.color }}
            />
            <span className="typo-body text-foreground/90 truncate">
              {tx(t.templates.presets.preview_group_binding, { name: preset.group.name })}
            </span>
          </section>
        )}

        <AnimatePresence initial={false}>
          {customizing && a.schema && a.stage === 'preview' && (
            <motion.div
              key="questionnaire"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <PresetQuestionnaireForm
                schema={a.schema}
                value={a.overrides}
                onChange={a.setOverrides}
                expandedRoles={a.expandedRoles}
                onToggleRole={a.toggleRoleExpanded}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Member rows — preview state shows just role + template; live
            adoption switches to status badges. */}
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
                  data-selected={interactive ? selected : undefined}
                  className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-card border transition-colors ${
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
                    className="typo-body font-medium min-w-[90px] uppercase tracking-wider text-[11px]"
                    style={{ color: selected || !interactive ? teamColor : undefined }}
                  >
                    {row.role}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="typo-body text-foreground/90 block truncate">
                      {meta?.name ?? row.templateId}
                    </span>
                    {meta?.description && (
                      <span className="typo-caption text-foreground block truncate">
                        {meta.description}
                      </span>
                    )}
                  </span>
                  {a.stage !== 'preview' && <StatusBadge row={row} t={t} />}
                </RowTag>
              );
            })}
          </ul>
        </section>
      </div>

      {/* Footer — adoption gate or "open team" CTA */}
      <div className="px-5 py-3 border-t border-primary/10 flex items-center justify-between gap-2">
        <p className={`typo-caption ${a.handoffNeedsRepair ? 'text-amber-400' : 'text-foreground'}`}>
          {a.stage === 'preview' && t.templates.presets.footer_preview_hint}
          {a.stage === 'adopting' && t.templates.presets.footer_adopting_hint}
          {a.stage === 'done' && a.result && (
            a.handoffNeedsRepair
              ? t.templates.presets.footer_handoff_warning
              : a.result.failed_members.length === 0
                ? tx(t.templates.presets.footer_done_hint, { count: a.result.members.length })
                : tx(t.templates.presets.footer_done_partial, {
                    ok: a.result.members.length,
                    failed: a.result.failed_members.length,
                  })
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t.common.close}
          </Button>
          {a.stage === 'preview' && a.schema && a.schema.total_question_count > 0 && (
            <>
              {customizing && (
                <PresetQuestionnaireBulkControls
                  schema={a.schema}
                  expandedRoles={a.expandedRoles}
                  onSetAllExpanded={a.setExpandedRoles}
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                icon={<Settings2 className="w-4 h-4" />}
                onClick={() => setCustomizing((p) => !p)}
                data-testid="preset-customize-toggle"
              >
                {customizing
                  ? a.overrideCount > 0
                    ? tx(t.templates.presets.customize_hide_with_changes, { count: a.overrideCount })
                    : t.templates.presets.customize_hide
                  : t.templates.presets.customize_show}
              </Button>
            </>
          )}
          {a.stage === 'preview' && (
            <Button
              variant="primary"
              size="sm"
              icon={<CheckCircle2 className="w-4 h-4" />}
              onClick={() => void a.adopt()}
              disabled={a.selectedRoles.size === 0}
              data-testid="preset-adopt-all-button"
            >
              {tx(
                a.selectedRoles.size === 1
                  ? t.templates.presets.adopt_all_button_one
                  : t.templates.presets.adopt_all_button_other,
                { count: a.selectedRoles.size },
              )}
            </Button>
          )}
          {a.stage === 'done' && a.result && a.result.failed_members.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              icon={<RotateCcw className="w-4 h-4" />}
              onClick={() => void a.retry()}
              data-testid="preset-retry-failed-button"
            >
              {tx(t.templates.presets.retry_failed_button, { count: a.result.failed_members.length })}
            </Button>
          )}
          {a.stage === 'done' && a.handoffNeedsRepair && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Wrench className="w-4 h-4" />}
              onClick={() => void a.repairHandoff()}
              disabled={a.repairingHandoff}
              data-testid="preset-repair-handoff-button"
            >
              {t.templates.presets.repair_handoff_button}
            </Button>
          )}
          {a.stage === 'done' && a.result && (
            <Button
              variant="primary"
              size="sm"
              onClick={a.openTeam}
              data-testid="preset-open-team-button"
            >
              {t.templates.presets.open_team_button}
            </Button>
          )}
        </div>
      </div>
    </BaseModal>
  );
}

function StatusBadge({ row, t }: { row: PresetMemberRowState; t: ReturnType<typeof useTranslation>['t'] }) {
  if (row.status === 'queued') {
    return (
      <span className="typo-caption text-foreground uppercase tracking-wider">
        {t.templates.presets.status_queued}
      </span>
    );
  }
  if (row.status === 'adopting') {
    return (
      <span className="inline-flex items-center gap-1.5 typo-caption text-indigo-300">
        <Loader2 className="w-3 h-3 animate-spin" />
        {t.templates.presets.status_adopting}
      </span>
    );
  }
  if (row.status === 'done') {
    return (
      <span className="inline-flex items-center gap-1.5 typo-caption text-emerald-300">
        <CheckCircle2 className="w-3 h-3" />
        {t.templates.presets.status_done}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 typo-caption text-red-400 max-w-[180px] truncate"
      title={row.error ?? t.templates.presets.status_failed}
    >
      <AlertCircle className="w-3 h-3 flex-shrink-0" />
      {row.error ?? t.templates.presets.status_failed}
    </span>
  );
}
