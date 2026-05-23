import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Layers, Loader2, RotateCcw, Settings2, Users, X, AlertCircle } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useToastStore } from '@/stores/toastStore';
import type { TeamPreset } from '@/lib/bindings/TeamPreset';
import type { AdoptedTeamPresetResult } from '@/lib/bindings/AdoptedTeamPresetResult';
import type { PresetAdoptionSchema } from '@/lib/bindings/PresetAdoptionSchema';
import {
  adoptTeamPreset,
  getPresetAdoptionSchema,
  retryTeamPresetMembers,
  type PresetParameterOverrides,
} from '@/api/templates/teamPresets';
import { useTypedTauriEvent } from '@/hooks/useTauriEvent';
import { EventName } from '@/lib/eventRegistry';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { silentCatch } from '@/lib/silentCatch';
import { PresetGraphAdapter } from './PresetGraphAdapter';
import {
  PresetQuestionnaireBulkControls,
  PresetQuestionnaireForm,
} from './PresetQuestionnaireForm';

type RowStatus = 'queued' | 'adopting' | 'done' | 'failed';

interface MemberRowState {
  role: string;
  templateId: string;
  status: RowStatus;
  error?: string;
}

interface PresetPreviewModalProps {
  open: boolean;
  preset: TeamPreset;
  onClose: () => void;
}

/**
 * Preview + adoption modal for a single TeamPreset manifest.
 *
 * Two states sharing one modal frame:
 *
 *   1. **Preview** (initial): renders the team graph adapter, lists each
 *      member with role + template id, shows an "Adopt all" CTA. User
 *      can close the modal without side effects.
 *
 *   2. **Adopting**: a single click on "Adopt all" fires
 *      `adopt_team_preset` and the modal turns into a live status table.
 *      Per-member rows update from `team-preset-adopt-progress` events
 *      (queued → adopting → done / failed) so the user watches the work
 *      land in real time. On completion the team is auto-navigated to —
 *      the modal closes and the sidebar switches to Agents → Teams with
 *      the new team selected.
 *
 *  Partial failures: the success toast still fires (the team and the
 *  members that DID land are real value); failed rows stay visible in
 *  the modal until the user dismisses, with the underlying error
 *  string inline so they can decide whether to retry the manifest or
 *  fix the failing template's prerequisites.
 */
export function PresetPreviewModal({ open, preset, onClose }: PresetPreviewModalProps) {
  const { t, tx } = useTranslation();
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setAgentTab = useSystemStore((s) => s.setAgentTab);
  const fetchPersonas = useAgentStore((s) => s.fetchPersonas);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  const fetchGroups = usePipelineStore((s) => s.fetchGroups);
  const addToast = useToastStore((s) => s.addToast);

  // Per-member row state. Seeded from preset.members in declaration order
  // when the modal opens / adoption starts; mutated by progress events.
  const [rows, setRows] = useState<MemberRowState[]>([]);
  const [adoptionState, setAdoptionState] = useState<'preview' | 'adopting' | 'done'>('preview');
  const [result, setResult] = useState<AdoptedTeamPresetResult | null>(null);

  // Combined-questionnaire state. The schema loads lazily on modal
  // open (it triggers ~6 template-design reads on the Rust side, so
  // not free); the form only renders when the user explicitly clicks
  // "Customize" — keeps the default "preview → adopt" path one click
  // and one render away from the gallery.
  const [schema, setSchema] = useState<PresetAdoptionSchema | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [overrides, setOverrides] = useState<PresetParameterOverrides>({});
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());

  // Reset whenever the modal re-opens or the preset changes (gallery
  // switches presets without unmounting the modal).
  useEffect(() => {
    if (!open) return;
    setRows(
      preset.members.map((m) => ({
        role: m.role,
        templateId: m.template_id,
        status: 'queued',
      })),
    );
    setAdoptionState('preview');
    setResult(null);
    setCustomizing(false);
    setOverrides({});
    setExpandedRoles(new Set());
    // Kick off schema fetch in the background — surfaces the
    // "Customize" affordance with the right question count once
    // resolved. Failure is logged but non-fatal: the "Adopt with
    // defaults" path still works without it.
    getPresetAdoptionSchema(preset.id)
      .then(setSchema)
      .catch((err) => {
        silentCatch('PresetPreviewModal:loadSchema')(err);
        setSchema(null);
      });
  }, [open, preset]);

  // Listen for per-member progress events. Filter by preset_id so two
  // simultaneous adoptions (unusual but possible) don't bleed into each
  // other's status tables.
  useTypedTauriEvent(
    EventName.TEAM_PRESET_ADOPT_PROGRESS,
    useCallback(
      (payload) => {
        if (payload.preset_id !== preset.id) return;
        setRows((prev) =>
          prev.map((r) =>
            r.role === payload.role
              ? { ...r, status: payload.status as RowStatus, error: payload.error ?? undefined }
              : r,
          ),
        );
      },
      [preset.id],
    ),
  );

  const handleAdopt = useCallback(async () => {
    setAdoptionState('adopting');
    setResult(null);
    try {
      // Only send overrides if the user actually opened the
      // questionnaire AND changed at least one value. Sending an
      // empty {} works fine on the Rust side (it becomes None for
      // each member) but keeping the wire payload minimal makes
      // logs / Sentry breadcrumbs easier to read.
      const overridePayload =
        Object.keys(overrides).length > 0 ? overrides : null;
      const res = await adoptTeamPreset(preset.id, overridePayload);
      setResult(res);
      // Refresh sidebar / detail stores so the new team + personas appear
      // immediately without a manual reload.
      await Promise.all([
        fetchPersonas?.().catch(silentCatch('PresetPreviewModal:fetchPersonas')),
        fetchTeams().catch(silentCatch('PresetPreviewModal:fetchTeams')),
        fetchGroups().catch(silentCatch('PresetPreviewModal:fetchGroups')),
      ]);
      setAdoptionState('done');
      if (res.failed_members.length === 0) {
        addToast(
          tx(t.templates.presets.toast_success, {
            count: res.members.length,
            name: preset.name,
          }),
          'success',
        );
      } else {
        // Partial success — Stage-6 added the warning tone (amber band,
        // polite ARIA) for exactly this case: real value landed AND
        // meaningful failures occurred, so neither success-tone-lie nor
        // error-tone-panic fits.
        addToast(
          tx(t.templates.presets.toast_partial, {
            ok: res.members.length,
            failed: res.failed_members.length,
          }),
          'warning',
        );
      }
    } catch (err) {
      silentCatch('PresetPreviewModal:adopt')(err);
      addToast(t.templates.presets.toast_failure, 'error');
      setAdoptionState('preview'); // allow retry
    }
  }, [preset, overrides, fetchPersonas, fetchTeams, fetchGroups, addToast, t, tx]);

  const handleOpenTeam = useCallback(() => {
    setSidebarSection('personas');
    setAgentTab('team');
    onClose();
  }, [setSidebarSection, setAgentTab, onClose]);

  /**
   * Retry the currently-failed rows in place. The IPC reuses the same
   * progress event stream so the existing per-row badges animate the
   * same way; on resolution we replace `result` so failed_members
   * reflects the new (possibly empty) failure set. State machine stays
   * in `done` throughout — the modal doesn't go back to `adopting`
   * because the team itself is already there; only specific roles are
   * being refilled.
   */
  const handleRetry = useCallback(async () => {
    if (!result) return;
    const failedRoles = result.failed_members.map((f) => f.role);
    if (failedRoles.length === 0) return;
    // Optimistically reset failed rows to `adopting` so the user sees
    // the spinner immediately while the IPC fires.
    setRows((prev) =>
      prev.map((r) =>
        failedRoles.includes(r.role)
          ? { ...r, status: 'adopting' as RowStatus, error: undefined }
          : r,
      ),
    );
    try {
      // Forward the same override map to the retry — so a customized
      // answer that landed correctly on a successful member's first
      // attempt also applies to retried failures from the same modal
      // session. If the user had cleared overrides between adopt and
      // retry, `overrides` would be empty and retry defaults to
      // template values.
      const overridePayload =
        Object.keys(overrides).length > 0 ? overrides : null;
      const res = await retryTeamPresetMembers(
        preset.id,
        result.team_id,
        result.group_id,
        failedRoles,
        overridePayload,
      );
      setResult(res);
      await Promise.all([
        fetchPersonas?.().catch(silentCatch('PresetPreviewModal:fetchPersonas')),
        fetchTeams().catch(silentCatch('PresetPreviewModal:fetchTeams')),
        fetchGroups().catch(silentCatch('PresetPreviewModal:fetchGroups')),
      ]);
      if (res.failed_members.length === 0) {
        addToast(t.templates.presets.toast_retry_success, 'success');
      } else {
        addToast(
          tx(t.templates.presets.toast_retry_partial, {
            ok: failedRoles.length - res.failed_members.length,
            failed: res.failed_members.length,
          }),
          'warning',
        );
      }
    } catch (err) {
      silentCatch('PresetPreviewModal:retry')(err);
      addToast(t.templates.presets.toast_retry_failure, 'error');
    }
  }, [result, preset.id, overrides, fetchPersonas, fetchTeams, fetchGroups, addToast, t, tx]);

  const toggleRole = useCallback((role: string) => {
    setExpandedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) {
        next.delete(role);
      } else {
        next.add(role);
      }
      return next;
    });
  }, []);

  const overrideCount = useMemo(
    () => Object.values(overrides).reduce((acc, m) => acc + Object.keys(m).length, 0),
    [overrides],
  );

  // Map result.failed_members onto the row state in case any failures
  // arrived faster than the progress events (very small race window).
  const rowsWithResult = useMemo(() => {
    if (!result) return rows;
    const failedByRole = new Map(result.failed_members.map((f) => [f.role, f]));
    return rows.map((r) => {
      const fail = failedByRole.get(r.role);
      if (fail && r.status !== 'failed') {
        return { ...r, status: 'failed' as RowStatus, error: fail.reason };
      }
      return r;
    });
  }, [rows, result]);

  const teamColor = preset.team.color ?? preset.color;

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId="preset-preview-title"
      size="lg"
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

        {customizing && schema && adoptionState === 'preview' && (
          <PresetQuestionnaireForm
            schema={schema}
            value={overrides}
            onChange={setOverrides}
            expandedRoles={expandedRoles}
            onToggleRole={toggleRole}
          />
        )}

        {/* Member rows — preview state shows just role + template; live
            adoption switches to status badges. Same row layout, different
            trailing element. */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="typo-label uppercase tracking-wider text-foreground/70">
              {t.templates.presets.preview_members_heading}
            </h3>
            <span className="typo-label text-foreground/50">({preset.members.length})</span>
          </div>
          <ul className="space-y-1.5">
            {rowsWithResult.map((row) => (
              <li
                key={row.role}
                data-testid={`preset-row-${row.role}`}
                data-status={row.status}
                className="flex items-center gap-3 px-3 py-2 rounded-card bg-secondary/30 border border-primary/10"
              >
                <span
                  className="typo-body font-medium text-foreground/90 min-w-[100px] uppercase tracking-wider text-[11px]"
                  style={{ color: teamColor }}
                >
                  {row.role}
                </span>
                <span className="typo-body text-foreground flex-1 truncate font-mono text-[12px]">
                  {row.templateId}
                </span>
                {adoptionState !== 'preview' && (
                  <StatusBadge row={row} t={t} />
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Footer — adoption gate or "open team" CTA */}
      <div className="px-5 py-3 border-t border-primary/10 flex items-center justify-between gap-2">
        <p className="typo-caption text-foreground/60">
          {adoptionState === 'preview' && t.templates.presets.footer_preview_hint}
          {adoptionState === 'adopting' && t.templates.presets.footer_adopting_hint}
          {adoptionState === 'done' && result && (
            result.failed_members.length === 0
              ? tx(t.templates.presets.footer_done_hint, { count: result.members.length })
              : tx(t.templates.presets.footer_done_partial, {
                  ok: result.members.length,
                  failed: result.failed_members.length,
                })
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t.common.close}
          </Button>
          {adoptionState === 'preview' && schema && schema.total_question_count > 0 && (
            <>
              {customizing && (
                <PresetQuestionnaireBulkControls
                  schema={schema}
                  expandedRoles={expandedRoles}
                  onSetAllExpanded={setExpandedRoles}
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
                  ? overrideCount > 0
                    ? tx(t.templates.presets.customize_hide_with_changes, {
                        count: overrideCount,
                      })
                    : t.templates.presets.customize_hide
                  : t.templates.presets.customize_show}
              </Button>
            </>
          )}
          {adoptionState === 'preview' && (
            <Button
              variant="primary"
              size="sm"
              icon={<CheckCircle2 className="w-4 h-4" />}
              onClick={() => void handleAdopt()}
              data-testid="preset-adopt-all-button"
            >
              {tx(
                preset.members.length === 1
                  ? t.templates.presets.adopt_all_button_one
                  : t.templates.presets.adopt_all_button_other,
                { count: preset.members.length },
              )}
            </Button>
          )}
          {adoptionState === 'done' && result && result.failed_members.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              icon={<RotateCcw className="w-4 h-4" />}
              onClick={() => void handleRetry()}
              data-testid="preset-retry-failed-button"
            >
              {tx(t.templates.presets.retry_failed_button, {
                count: result.failed_members.length,
              })}
            </Button>
          )}
          {adoptionState === 'done' && result && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleOpenTeam}
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

function StatusBadge({ row, t }: { row: MemberRowState; t: ReturnType<typeof useTranslation>['t'] }) {
  if (row.status === 'queued') {
    return (
      <span className="typo-caption text-foreground/40 uppercase tracking-wider">
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
  // failed
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
