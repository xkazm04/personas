import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Settings, Check, Trash2, Layers } from 'lucide-react';
import { TEAM_COLORS } from '../CreateTeamForm';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useToastStore } from '@/stores/toastStore';
import { updateTeam } from '@/api/pipeline/teams';
import { useTranslation } from '@/i18n/useTranslation';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import { silentCatch } from '@/lib/silentCatch';
import type { UpdateTeamInput } from '@/lib/bindings/UpdateTeamInput';

/**
 * Workspace settings pane (Groups→Teams consolidation, Phase 2c). A team
 * is now the workspace: this surfaces the shared_instructions + defaults
 * that migrated off PersonaGroup (Phase 3) and lets the user edit them.
 *
 * The non-workspace UpdateTeamInput fields are sent as null = "skip"
 * (their plain Option<Option> serde default), so this saves ONLY the
 * workspace facet without disturbing name/description/canvas/etc.
 */

const MODEL_OPTIONS = [
  { key: 'inherit', model: null },
  { key: 'haiku', model: 'claude-haiku-4-5-20251001' },
  { key: 'sonnet', model: 'claude-sonnet-4-6' },
  { key: 'opus', model: 'claude-opus-4-8' },
] as const;

function modelKeyFromProfile(profile: string | null): string {
  if (!profile) return 'inherit';
  const lower = profile.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return 'inherit';
}

export function TeamWorkspacePane({ teamId, onDirtyChange }: {
  teamId: string;
  /** Reports unsaved-edit state so the studio can guard navigation away. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const ts = t.pipeline.team_studio;
  const team = usePipelineStore((s) => s.teams.find((x) => x.id === teamId)) ?? null;
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  const deleteTeam = usePipelineStore((s) => s.deleteTeam);
  const addToast = useToastStore((s) => s.addToast);

  const [instructions, setInstructions] = useState('');
  const [modelKey, setModelKey] = useState('inherit');
  const [budget, setBudget] = useState('');
  const [turns, setTurns] = useState('');
  // Identity facet — editable post-creation (was frozen at create until now).
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  // Disband confirm: first click arms, second confirms. Auto-disarms after a
  // few seconds so a stray click can't leave it primed.
  const [confirmDisband, setConfirmDisband] = useState(false);
  const [disbanding, setDisbanding] = useState(false);

  // Seed from the team whenever it loads / changes.
  useEffect(() => {
    if (!team) return;
    setInstructions(team.shared_instructions ?? '');
    setModelKey(modelKeyFromProfile(team.default_model_profile ?? null));
    setBudget(team.default_max_budget_usd != null ? String(team.default_max_budget_usd) : '');
    setTurns(team.default_max_turns != null ? String(team.default_max_turns) : '');
    setName(team.name);
    setDescription(team.description ?? '');
    setIcon(team.icon ?? '');
    setColor(team.color ?? '#6366f1');
  }, [team]);

  // Auto-disarm the disband confirm after a short window.
  useEffect(() => {
    if (!confirmDisband) return;
    const timer = setTimeout(() => setConfirmDisband(false), 3500);
    return () => clearTimeout(timer);
  }, [confirmDisband]);

  const identityDirty = useMemo(() => {
    if (!team) return false;
    return (
      (name.trim() !== team.name && name.trim() !== '') ||
      (description.trim() !== (team.description ?? '') && description.trim() !== '') ||
      (icon.trim() !== (team.icon ?? '') && icon.trim() !== '') ||
      color !== (team.color ?? '#6366f1')
    );
  }, [team, name, description, icon, color]);

  const dirty = useMemo(() => {
    if (!team) return false;
    const profile = MODEL_OPTIONS.find((m) => m.key === modelKey)?.model ?? null;
    const budgetNum = budget.trim() === '' ? null : Number(budget);
    const turnsNum = turns.trim() === '' ? null : Number(turns);
    return (
      identityDirty ||
      (instructions || null) !== (team.shared_instructions ?? null) ||
      profile !== (team.default_model_profile ? JSON.parse(team.default_model_profile).model ?? null : null) ||
      budgetNum !== (team.default_max_budget_usd ?? null) ||
      turnsNum !== (team.default_max_turns ?? null)
    );
  }, [team, identityDirty, instructions, modelKey, budget, turns]);

  // Mirror the dirty flag up to the studio shell; clear it on unmount so a
  // discarded pane doesn't leave a stale guard behind.
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const handleSave = useCallback(async () => {
    if (!team) return;
    setSaving(true);
    const profileModel = MODEL_OPTIONS.find((m) => m.key === modelKey)?.model ?? null;
    const input: UpdateTeamInput = {
      // Identity facet: value sets, null skips (plain Option — no clear lane;
      // description/icon lack the double_option deserializer, so an emptied
      // field is treated as "unchanged", never as "clear").
      name: name.trim() !== '' && name.trim() !== team.name ? name.trim() : null,
      description: description.trim() !== '' && description.trim() !== (team.description ?? '') ? description.trim() : null,
      canvas_data: null,
      team_config: null,
      icon: icon.trim() !== '' && icon.trim() !== (team.icon ?? '') ? icon.trim() : null,
      color: color !== (team.color ?? '#6366f1') ? color : null,
      enabled: null,
      // Workspace facet — value sets, null clears (double_option).
      shared_instructions: instructions.trim() === '' ? null : instructions,
      default_model_profile: profileModel ? JSON.stringify({ model: profileModel, provider: 'anthropic' }) : null,
      default_max_budget_usd: budget.trim() === '' ? null : Number(budget),
      default_max_turns: turns.trim() === '' ? null : Number(turns),
    };
    try {
      await updateTeam(teamId, input);
      await fetchTeams();
      setSavedAt(Date.now());
      addToast(ts.workspace_saved, 'success');
    } catch (err) {
      silentCatch('teamStudio/TeamWorkspacePane:save')(err);
      addToast(ts.workspace_save_failed, 'error');
    } finally {
      setSaving(false);
    }
  }, [team, teamId, name, description, icon, color, instructions, modelKey, budget, turns, fetchTeams, addToast, ts]);

  // Disband: deletes the PersonaTeam (cascading membership + connections) but
  // NOT the member personas — they survive ungrouped. The store's deleteTeam
  // reports errors and, on success, clears selectedTeamId, which unmounts this
  // pane and returns to the Teams table.
  const handleDisband = useCallback(async () => {
    setDisbanding(true);
    try {
      await deleteTeam(teamId);
    } finally {
      setDisbanding(false);
      setConfirmDisband(false);
    }
  }, [deleteTeam, teamId]);

  if (!team) {
    return <div className="h-full flex items-center justify-center typo-body text-foreground">{ts.workspace}</div>;
  }

  return (
    <div className="h-full flex flex-col gap-4 overflow-y-auto pr-1">
      <div className="flex items-center gap-2 flex-shrink-0">
        <Settings className="w-4 h-4 text-foreground" />
        <h3 className="typo-label uppercase tracking-wider text-foreground">{ts.workspace_settings}</h3>
      </div>
      <p className="typo-caption text-foreground -mt-2">{ts.workspace_hint}</p>

      {/* Team identity — name / description / icon / color, editable post-creation */}
      <div className="rounded-card border border-primary/10 bg-secondary/10 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-indigo-300/80" />
          <span className="typo-label uppercase tracking-wider text-foreground">{ts.identity_section}</span>
        </div>
        <div className="grid grid-cols-[1fr_88px] gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="typo-label text-foreground/85">{t.pipeline.team_name}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-input bg-secondary/30 border border-primary/20 text-foreground typo-body px-3 py-2 focus:outline-none focus:border-primary/60"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="typo-label text-foreground/85">{ts.identity_icon_label}</span>
            <input
              type="text"
              value={icon}
              maxLength={4}
              onChange={(e) => setIcon(e.target.value)}
              className="w-full rounded-input bg-secondary/30 border border-primary/20 text-foreground typo-body px-3 py-2 text-center focus:outline-none focus:border-primary/60"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="typo-label text-foreground/85">{t.common.description}</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-input bg-secondary/30 border border-primary/20 text-foreground typo-body px-3 py-2 focus:outline-none focus:border-primary/60"
          />
        </label>
        <div>
          <span className="typo-label text-foreground/85 mb-1.5 block">{t.pipeline.color}</span>
          <div className="flex gap-1.5 flex-wrap">
            {Object.entries(TEAM_COLORS).map(([hex, colorName]) => (
              <button
                key={hex}
                type="button"
                onClick={() => setColor(hex)}
                title={colorName}
                aria-pressed={color === hex}
                className={`w-7 h-7 rounded-card transition-all flex items-center justify-center ${
                  color === hex ? 'ring-2 ring-offset-2 ring-offset-background scale-110' : 'hover:scale-105'
                }`}
                style={{ backgroundColor: hex }}
              >
                {color === hex && <Check className="w-3.5 h-3.5 text-foreground drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />}
              </button>
            ))}
          </div>
        </div>
        <p className="typo-caption text-foreground">{ts.identity_hint}</p>
      </div>

      {/* Shared instructions */}
      <label className="flex flex-col gap-1.5">
        <span className="typo-label text-foreground/85">{ts.shared_instructions_label}</span>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={5}
          placeholder={ts.shared_instructions_placeholder}
          className="w-full resize-none rounded-input bg-secondary/30 border border-primary/20 text-foreground typo-body px-3 py-2 focus:outline-none focus:border-primary/60"
        />
      </label>

      {/* Defaults */}
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="typo-label text-foreground/85">{ts.default_model_label}</span>
          <ThemedSelect value={modelKey} onValueChange={setModelKey}>
            {MODEL_OPTIONS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.key === 'inherit' ? ts.workspace_inherit : m.key.charAt(0).toUpperCase() + m.key.slice(1)}
              </option>
            ))}
          </ThemedSelect>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="typo-label text-foreground/85">{ts.default_budget_label}</span>
          <NumberStepper
            value={budget.trim() === '' ? null : Number(budget)}
            onChange={(v) => setBudget(v == null ? '' : String(v))}
            min={0}
            step={0.01}
            allowEmpty
            prefix="$"
            ariaLabel={ts.default_budget_label}
            className="w-full"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="typo-label text-foreground/85">{ts.default_turns_label}</span>
          <NumberStepper
            value={turns.trim() === '' ? null : Number(turns)}
            onChange={(v) => setTurns(v == null ? '' : String(v))}
            min={0}
            allowEmpty
            ariaLabel={ts.default_turns_label}
            className="w-full"
          />
        </label>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={() => void handleSave()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border border-primary/30 bg-primary/15 typo-body font-medium text-primary hover:bg-primary/25 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {ts.workspace_save}
        </button>
        {savedAt > 0 && !dirty && (
          <span className="typo-caption text-emerald-300">{ts.workspace_saved}</span>
        )}
      </div>

      {/* Danger zone — disband the team (keeps personas). */}
      <div className="mt-2 pt-4 border-t border-red-500/15 flex flex-col gap-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-red-400/80" />
          <h3 className="typo-label uppercase tracking-wider text-red-300">{ts.disband_heading}</h3>
        </div>
        <p className="typo-caption text-foreground">{ts.disband_hint}</p>
        <div className="flex items-center gap-2 mt-1">
          {confirmDisband ? (
            <>
              <button
                type="button"
                disabled={disbanding}
                onClick={() => void handleDisband()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border border-red-500/40 bg-red-500/15 typo-body font-medium text-red-300 hover:bg-red-500/25 disabled:opacity-50 transition-colors"
              >
                {disbanding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {ts.disband_confirm}
              </button>
              <button
                type="button"
                disabled={disbanding}
                onClick={() => setConfirmDisband(false)}
                className="inline-flex items-center px-3 py-1.5 rounded-interactive border border-primary/15 typo-body text-foreground hover:bg-secondary/40 disabled:opacity-50 transition-colors"
              >
                {ts.cancel}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDisband(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border border-red-500/30 typo-body font-medium text-red-300 hover:bg-red-500/15 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {ts.disband}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
