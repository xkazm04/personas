import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { repairTeamHandoff } from '@/api/pipeline/teams';
import { useTypedTauriEvent } from '@/hooks/useTauriEvent';
import { EventName } from '@/lib/eventRegistry';
import { silentCatch } from '@/lib/silentCatch';

export type PresetRowStatus = 'queued' | 'adopting' | 'done' | 'failed';

export interface PresetMemberRowState {
  role: string;
  templateId: string;
  status: PresetRowStatus;
  error?: string;
}

export type PresetAdoptionStage = 'preview' | 'adopting' | 'done';

interface UsePresetAdoptionOptions {
  /**
   * Called once an adoption finishes (success or partial) and the user
   * confirms "open team". Receives the new team id. The modal navigates
   * the sidebar + closes itself; the in-app Teams view closes the flow +
   * selects the team. When omitted, falls back to the sidebar-navigation
   * behaviour the original modal shipped with.
   */
  onOpenTeam?: (result: AdoptedTeamPresetResult) => void;
}

/**
 * Headless preset-adoption state machine — the brains behind both the
 * `PresetPreviewModal` (Templates → Presets) and the in-app Teams
 * `PresetStudio` flow. Owns the per-member row state, the combined
 * questionnaire schema, the selected-role subset, override map, and the
 * adopt / retry actions; the live `team-preset-adopt-progress` event
 * stream drives the per-row status.
 *
 * Kept UI-agnostic so the two surfaces can render radically different
 * layouts over the same behaviour (the /prototype variants reuse this
 * verbatim).
 */
export function usePresetAdoption(preset: TeamPreset, opts: UsePresetAdoptionOptions = {}) {
  const { t, tx } = useTranslation();
  const { onOpenTeam } = opts;
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const fetchPersonas = useAgentStore((s) => s.fetchPersonas);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  const addToast = useToastStore((s) => s.addToast);

  const [rows, setRows] = useState<PresetMemberRowState[]>([]);
  const [stage, setStage] = useState<PresetAdoptionStage>('preview');
  const [result, setResult] = useState<AdoptedTeamPresetResult | null>(null);
  const [schema, setSchema] = useState<PresetAdoptionSchema | null>(null);
  const [overrides, setOverrides] = useState<PresetParameterOverrides>({});
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  // Step-5 handoff wiring can fail silently on the backend (best-effort), in
  // which case the team is created but won't cascade past its entry member.
  // `result.handoff_wired === false` surfaces that; `handoffRepaired` flips
  // once the user runs the in-modal repair so the warning clears without a
  // full re-fetch. `repairingHandoff` gates the button while the repair runs.
  const [handoffRepaired, setHandoffRepaired] = useState(false);
  const [repairingHandoff, setRepairingHandoff] = useState(false);
  // Synchronous re-entrancy guard: `stage` lags a render behind setStage,
  // so a double-click could fire two adopt() calls before the button reflects
  // the 'adopting' stage. The backend also single-flights per preset, but this
  // avoids the doomed second request (and its error toast) entirely.
  const adoptingRef = useRef(false);

  // Reset whenever the preset changes (gallery switches presets without
  // unmounting). Kick the schema fetch in the background so the customize
  // affordance surfaces with the right question count once resolved.
  useEffect(() => {
    setRows(
      preset.members.map((m) => ({
        role: m.role,
        templateId: m.template_id,
        status: 'queued' as PresetRowStatus,
      })),
    );
    setSelectedRoles(new Set(preset.members.map((m) => m.role)));
    setStage('preview');
    setResult(null);
    setOverrides({});
    setExpandedRoles(new Set());
    setHandoffRepaired(false);
    getPresetAdoptionSchema(preset.id)
      .then(setSchema)
      .catch((err) => {
        silentCatch('usePresetAdoption:loadSchema')(err);
        setSchema(null);
      });
  }, [preset]);

  // Per-member progress events. Filter by preset_id so two simultaneous
  // adoptions don't bleed into each other's status tables.
  useTypedTauriEvent(
    EventName.TEAM_PRESET_ADOPT_PROGRESS,
    useCallback(
      (payload) => {
        if (payload.preset_id !== preset.id) return;
        setRows((prev) =>
          prev.map((r) =>
            r.role === payload.role
              ? { ...r, status: payload.status as PresetRowStatus, error: payload.error ?? undefined }
              : r,
          ),
        );
      },
      [preset.id],
    ),
  );

  const adopt = useCallback(async () => {
    if (adoptingRef.current) return;
    adoptingRef.current = true;
    setRows(
      preset.members
        .filter((m) => selectedRoles.has(m.role))
        .map((m) => ({ role: m.role, templateId: m.template_id, status: 'queued' as PresetRowStatus })),
    );
    setStage('adopting');
    setResult(null);
    setHandoffRepaired(false);
    try {
      const overridePayload = Object.keys(overrides).length > 0 ? overrides : null;
      const rolesPayload =
        selectedRoles.size === preset.members.length ? null : Array.from(selectedRoles);
      const res = await adoptTeamPreset(preset.id, overridePayload, rolesPayload);
      setResult(res);
      await Promise.all([
        fetchPersonas?.().catch(silentCatch('usePresetAdoption:fetchPersonas')),
        fetchTeams().catch(silentCatch('usePresetAdoption:fetchTeams')),
      ]);
      setStage('done');
      if (res.failed_members.length === 0) {
        if (res.handoff_wired) {
          addToast(
            tx(t.templates.presets.toast_success, { count: res.members.length, name: preset.name }),
            'success',
          );
        } else {
          // Members all landed, but the team can't cascade — don't claim full
          // success. Point the user at the in-modal "Repair handoff" affordance.
          addToast(t.templates.presets.toast_handoff_warning, 'warning');
        }
      } else {
        addToast(
          tx(t.templates.presets.toast_partial, {
            ok: res.members.length,
            failed: res.failed_members.length,
          }),
          'warning',
        );
      }
    } catch (err) {
      silentCatch('usePresetAdoption:adopt')(err);
      addToast(t.templates.presets.toast_failure, 'error');
      setStage('preview'); // allow retry
    } finally {
      adoptingRef.current = false;
    }
  }, [preset, overrides, selectedRoles, fetchPersonas, fetchTeams, addToast, t, tx]);

  const retry = useCallback(async () => {
    if (!result) return;
    const failedRoles = result.failed_members.map((f) => f.role);
    if (failedRoles.length === 0) return;
    setHandoffRepaired(false);
    setRows((prev) =>
      prev.map((r) =>
        failedRoles.includes(r.role)
          ? { ...r, status: 'adopting' as PresetRowStatus, error: undefined }
          : r,
      ),
    );
    try {
      const overridePayload = Object.keys(overrides).length > 0 ? overrides : null;
      const res = await retryTeamPresetMembers(
        preset.id,
        result.team_id,
        result.home_team_id,
        failedRoles,
        overridePayload,
      );
      setResult(res);
      await Promise.all([
        fetchPersonas?.().catch(silentCatch('usePresetAdoption:fetchPersonas')),
        fetchTeams().catch(silentCatch('usePresetAdoption:fetchTeams')),
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
      silentCatch('usePresetAdoption:retry')(err);
      addToast(t.templates.presets.toast_retry_failure, 'error');
    }
  }, [result, preset.id, overrides, fetchPersonas, fetchTeams, addToast, t, tx]);

  // Re-run the backend handoff wiring for the adopted team. The
  // `repair_team_handoff` command is idempotent, so a click is always safe;
  // on success the warning state clears (no re-fetch needed since the only
  // thing that changed is invisible trigger rows).
  const repairHandoff = useCallback(async () => {
    if (!result || repairingHandoff) return;
    setRepairingHandoff(true);
    try {
      await repairTeamHandoff(result.team_id);
      setHandoffRepaired(true);
      addToast(t.templates.presets.toast_handoff_repaired, 'success');
    } catch (err) {
      silentCatch('usePresetAdoption:repairHandoff')(err);
      addToast(t.templates.presets.toast_handoff_repair_failed, 'error');
    } finally {
      setRepairingHandoff(false);
    }
  }, [result, repairingHandoff, addToast, t]);

  const openTeam = useCallback(() => {
    if (onOpenTeam && result) {
      onOpenTeam(result);
      return;
    }
    // Default: navigate the sidebar to Teams → workspace (the modal's
    // original behaviour for the Templates surface).
    setSidebarSection('personas');
    useSystemStore.getState().setSidebarSection('teams');
    useSystemStore.getState().setTeamsTab('workspace');
  }, [onOpenTeam, result, setSidebarSection]);

  const toggleRoleExpanded = useCallback((role: string) => {
    setExpandedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }, []);

  const toggleMemberSelection = useCallback((role: string) => {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }, []);

  const overrideCount = useMemo(
    () => Object.values(overrides).reduce((acc, m) => acc + Object.keys(m).length, 0),
    [overrides],
  );

  // role → { name, description } from the adoption schema, so member rows
  // can show a friendly name + one-line description instead of the raw
  // template id. Empty until the schema resolves.
  const schemaByRole = useMemo(() => {
    const map = new Map<string, { name: string; description: string | null }>();
    schema?.members.forEach((m) =>
      map.set(m.role, { name: m.template_name, description: m.template_description }),
    );
    return map;
  }, [schema]);

  // Map result.failed_members onto row state in case any failures arrived
  // faster than the progress events (very small race window).
  const rowsWithResult = useMemo(() => {
    if (!result) return rows;
    const failedByRole = new Map(result.failed_members.map((f) => [f.role, f]));
    return rows.map((r) => {
      const fail = failedByRole.get(r.role);
      if (fail && r.status !== 'failed') {
        return { ...r, status: 'failed' as PresetRowStatus, error: fail.reason };
      }
      return r;
    });
  }, [rows, result]);

  // True once an adoption/retry landed a team whose handoff wiring failed and
  // the user hasn't repaired it yet — drives the modal's warning + repair CTA.
  const handoffNeedsRepair = !!result && result.handoff_wired === false && !handoffRepaired;

  return {
    // state
    stage,
    rows: rowsWithResult,
    result,
    schema,
    overrides,
    expandedRoles,
    selectedRoles,
    overrideCount,
    schemaByRole,
    handoffNeedsRepair,
    repairingHandoff,
    // setters / actions
    setOverrides,
    setExpandedRoles,
    adopt,
    retry,
    repairHandoff,
    openTeam,
    toggleRoleExpanded,
    toggleMemberSelection,
  } as const;
}

export type PresetAdoptionController = ReturnType<typeof usePresetAdoption>;
