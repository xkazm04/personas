import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Settings, Check } from 'lucide-react';
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

export function TeamWorkspacePane({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const ts = t.pipeline.team_studio;
  const team = usePipelineStore((s) => s.teams.find((x) => x.id === teamId)) ?? null;
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  const addToast = useToastStore((s) => s.addToast);

  const [instructions, setInstructions] = useState('');
  const [modelKey, setModelKey] = useState('inherit');
  const [budget, setBudget] = useState('');
  const [turns, setTurns] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);

  // Seed from the team whenever it loads / changes.
  useEffect(() => {
    if (!team) return;
    setInstructions(team.shared_instructions ?? '');
    setModelKey(modelKeyFromProfile(team.default_model_profile ?? null));
    setBudget(team.default_max_budget_usd != null ? String(team.default_max_budget_usd) : '');
    setTurns(team.default_max_turns != null ? String(team.default_max_turns) : '');
  }, [team]);

  const dirty = useMemo(() => {
    if (!team) return false;
    const profile = MODEL_OPTIONS.find((m) => m.key === modelKey)?.model ?? null;
    const budgetNum = budget.trim() === '' ? null : Number(budget);
    const turnsNum = turns.trim() === '' ? null : Number(turns);
    return (
      (instructions || null) !== (team.shared_instructions ?? null) ||
      profile !== (team.default_model_profile ? JSON.parse(team.default_model_profile).model ?? null : null) ||
      budgetNum !== (team.default_max_budget_usd ?? null) ||
      turnsNum !== (team.default_max_turns ?? null)
    );
  }, [team, instructions, modelKey, budget, turns]);

  const handleSave = useCallback(async () => {
    if (!team) return;
    setSaving(true);
    const profileModel = MODEL_OPTIONS.find((m) => m.key === modelKey)?.model ?? null;
    const input: UpdateTeamInput = {
      // null = skip for these (plain Option<Option> serde default).
      name: null,
      description: null,
      canvas_data: null,
      team_config: null,
      icon: null,
      color: null,
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
  }, [team, teamId, instructions, modelKey, budget, turns, fetchTeams, addToast, ts]);

  if (!team) {
    return <div className="h-full flex items-center justify-center typo-body text-foreground/40">{ts.workspace}</div>;
  }

  return (
    <div className="h-full flex flex-col gap-4 overflow-y-auto pr-1">
      <div className="flex items-center gap-2 flex-shrink-0">
        <Settings className="w-4 h-4 text-foreground/70" />
        <h3 className="typo-label uppercase tracking-wider text-foreground/80">{ts.workspace_settings}</h3>
      </div>
      <p className="typo-caption text-foreground/55 -mt-2">{ts.workspace_hint}</p>

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
    </div>
  );
}
