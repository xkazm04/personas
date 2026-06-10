import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Loader2, RotateCcw, Settings2 } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import {
  PresetQuestionnaireBulkControls,
  PresetQuestionnaireForm,
} from '@/features/templates/sub_presets/PresetQuestionnaireForm';
import type { PresetAdoptionController, PresetMemberRowState } from '@/features/templates/sub_presets/usePresetAdoption';

/**
 * Shared leaf components for the in-app preset-adoption variants. Each
 * variant owns its own layout but reuses these so the live status, the
 * stage-aware action buttons, and the customize panel behave identically
 * across Baseline / Blueprint / Pipeline / Split.
 */

/** role → friendly template name (from the adoption schema), memoised. */
export function useLabelByRole(a: PresetAdoptionController): Map<string, string> {
  return useMemo(() => {
    const map = new Map<string, string>();
    a.schemaByRole.forEach((v, role) => map.set(role, v.name));
    return map;
  }, [a.schemaByRole]);
}

export function PresetStatusBadge({ row }: { row: PresetMemberRowState }) {
  const { t } = useTranslation();
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
      <span className="inline-flex items-center gap-1.5 typo-caption text-status-success">
        <CheckCircle2 className="w-3 h-3" />
        {t.templates.presets.status_done}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 typo-caption text-status-error max-w-[200px] truncate"
      title={row.error ?? t.templates.presets.status_failed}
    >
      <AlertCircle className="w-3 h-3 flex-shrink-0" />
      {row.error ?? t.templates.presets.status_failed}
    </span>
  );
}

/**
 * Stage-aware primary actions, reused in every variant's footer:
 *   preview  → [Customize?] [Adopt N]
 *   done     → [Retry failed?] [Open team]
 *   adopting → (nothing — the live status table is the feedback)
 */
export function PresetPrimaryActions({
  a,
  customizing,
  onToggleCustomize,
}: {
  a: PresetAdoptionController;
  customizing: boolean;
  onToggleCustomize: () => void;
}) {
  const { t, tx } = useTranslation();

  if (a.stage === 'adopting') {
    return (
      <span className="inline-flex items-center gap-2 typo-body text-foreground">
        <Loader2 className="w-4 h-4 animate-spin text-indigo-300" />
        {t.templates.presets.footer_adopting_hint}
      </span>
    );
  }

  if (a.stage === 'done' && a.result) {
    return (
      <div className="flex items-center gap-2">
        {a.result.failed_members.length > 0 && (
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
        <Button variant="primary" size="sm" onClick={a.openTeam} data-testid="preset-open-team-button">
          {t.templates.presets.open_team_button}
        </Button>
      </div>
    );
  }

  // preview
  return (
    <div className="flex items-center gap-2">
      {a.schema && a.schema.total_question_count > 0 && (
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
            onClick={onToggleCustomize}
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
    </div>
  );
}

/** Collapsible combined questionnaire — shown when the user is customizing. */
export function PresetCustomizePanel({ a, customizing }: { a: PresetAdoptionController; customizing: boolean }) {
  return (
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
  );
}

/**
 * Compact per-member status list (role · template name · live badge).
 * Used by variants whose primary surface (e.g. the schematic graph)
 * can't render per-member status inline during adoption.
 */
export function PresetMemberStatusList({ a }: { a: PresetAdoptionController }) {
  const teamColorRows = a.rows;
  return (
    <ul className="space-y-1.5" data-testid="preset-member-status-list">
      {teamColorRows.map((row) => {
        const meta = a.schemaByRole.get(row.role);
        return (
          <li
            key={row.role}
            data-status={row.status}
            className="flex items-center gap-3 px-3 py-2 rounded-card border border-primary/10 bg-secondary/20"
          >
            <span className="typo-body font-medium min-w-[96px] uppercase tracking-wider text-[11px] text-foreground">
              {row.role}
            </span>
            <span className="typo-body text-foreground/90 flex-1 truncate">
              {meta?.name ?? row.templateId}
            </span>
            <PresetStatusBadge row={row} />
          </li>
        );
      })}
    </ul>
  );
}

/** Short status line for a preset's footer, mirrors the modal's hint copy. */
export function PresetFooterHint({ a }: { a: PresetAdoptionController }) {
  const { t, tx } = useTranslation();
  return (
    <p className="typo-caption text-foreground">
      {a.stage === 'preview' && t.templates.presets.footer_preview_hint}
      {a.stage === 'done' && a.result && (
        a.result.failed_members.length === 0
          ? tx(t.templates.presets.footer_done_hint, { count: a.result.members.length })
          : tx(t.templates.presets.footer_done_partial, {
              ok: a.result.members.length,
              failed: a.result.failed_members.length,
            })
      )}
    </p>
  );
}
