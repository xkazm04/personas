/**
 * ArenaPanelLedger — directional prototype variant for ArenaPanel.
 *
 * Metaphor: a quiet ledger page. This variant takes the shipping Arena
 * (two-column form + history) as its starting point and reworks it
 * against the design-system canon — semantic typography, status tokens,
 * `rounded-card` / `rounded-interactive` radii, `shadow-elevation-*`
 * and `border-border`. No SVG scenery, no torches, no wax seal; the
 * intent is "instrument panel", not "stage".
 *
 * Distinct from Colosseum in mental model:
 *   - Colosseum: spatial, heraldic, one enormous stage
 *   - Ledger:    data-dense single surface, rich roster rows, quiet
 *
 * Extractable pieces (consider hoisting if this wins):
 *   - LedgerHeaderBand
 *   - LedgerRosterRow (model picker row with stats)
 *   - LedgerUseCasePicker (inline pills)
 *   - LedgerReadinessRow (status-token readiness line)
 *   - LedgerLaunchBar
 */

import { useEffect, useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle, Check, Sparkles, ScrollText, BookOpen, Zap, Cloud, HardDrive,
  FileCode, Wrench, ShieldCheck, Target, Crown, Activity, Swords, Flame,
  OctagonAlert, Rocket, Trophy,
} from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useSelectedUseCases } from '@/stores/selectors/personaSelectors';
import { ALL_MODELS, selectedModelsToConfigs, ANTHROPIC_MODELS, OLLAMA_LOCAL_MODELS } from '@/lib/models/modelCatalog';
import type { ModelOption } from '@/lib/models/modelCatalog';
import { usePanelRunState } from '../../libs/usePanelRunState';
import { useHealthCheck } from '@/features/agents/health';
import { useTranslation } from '@/i18n/useTranslation';
import { ArenaHistory } from './ArenaHistory';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { resolveEffectiveModel } from '@/features/agents/sub_use_cases/libs/useCaseDetailHelpers';
import type { LabArenaRun } from '@/lib/bindings/LabArenaRun';

/* ------------------------------------------------------------------ */
/* Model metadata — compact, data-concrete rather than heraldic       */
/* ------------------------------------------------------------------ */

type ModelMeta = {
  sigil: LucideIcon;
  costTier: 'cheap' | 'mid' | 'premium';
  speedTier: 'fast' | 'mid' | 'slow';
  costLabel: string;
  speedLabel: string;
  providerTag: string;
};

const MODEL_META: Record<string, ModelMeta> = {
  haiku:  { sigil: Zap,        costTier: 'cheap',   speedTier: 'fast', costLabel: '$',   speedLabel: 'fast', providerTag: 'Anthropic' },
  sonnet: { sigil: ScrollText, costTier: 'mid',     speedTier: 'mid',  costLabel: '$$',  speedLabel: 'mid',  providerTag: 'Anthropic' },
  opus:   { sigil: BookOpen,   costTier: 'premium', speedTier: 'slow', costLabel: '$$$', speedLabel: 'slow', providerTag: 'Anthropic' },
};

function metaFor(id: string, provider: string): ModelMeta {
  const known = MODEL_META[id];
  if (known) return known;
  if (provider === 'ollama') {
    const isLocal = id.startsWith('ollama:');
    return {
      sigil: isLocal ? HardDrive : Cloud,
      costTier: 'cheap',
      speedTier: 'mid',
      costLabel: isLocal ? '—' : '$',
      speedLabel: 'mid',
      providerTag: isLocal ? 'Ollama · local' : 'Ollama · cloud',
    };
  }
  return {
    sigil: Sparkles,
    costTier: 'mid',
    speedTier: 'mid',
    costLabel: '—',
    speedLabel: '—',
    providerTag: provider,
  };
}

const ARENA_ROSTER: ModelOption[] = [...ANTHROPIC_MODELS, ...OLLAMA_LOCAL_MODELS];

/* ------------------------------------------------------------------ */
/* Chronicle — compute all-time-best model from summaries             */
/* ------------------------------------------------------------------ */

function computeAllTimeChampion(runs: LabArenaRun[]): { model: string; wins: number; total: number } | null {
  if (runs.length === 0) return null;
  const tally = new Map<string, number>();
  let total = 0;
  for (const r of runs) {
    if (!r.summary) continue;
    try {
      const parsed = JSON.parse(r.summary) as { best_quality_model?: string };
      if (parsed.best_quality_model) {
        tally.set(parsed.best_quality_model, (tally.get(parsed.best_quality_model) ?? 0) + 1);
        total++;
      }
    } catch { /* ignore malformed summary */ }
  }
  let best: { model: string; wins: number } | null = null;
  for (const [model, wins] of tally) {
    if (!best || wins > best.wins) best = { model, wins };
  }
  return best ? { ...best, total } : null;
}

/* ================================================================== */
/* Main                                                                 */
/* ================================================================== */

export function ArenaPanelLedger() {
  const { t } = useTranslation();
  const arenaRuns = useAgentStore((s) => s.arenaRuns);
  const arenaResultsMap = useAgentStore((s) => s.arenaResultsMap);
  const isLabRunning = useAgentStore((s) => s.isArenaRunning);
  const startArena = useAgentStore((s) => s.startArena);
  const cancelArena = useAgentStore((s) => s.cancelArena);
  const fetchArenaRuns = useAgentStore((s) => s.fetchArenaRuns);
  const fetchArenaResults = useAgentStore((s) => s.fetchArenaResults);
  const deleteArenaRun = useAgentStore((s) => s.deleteArenaRun);

  const {
    selectedPersona, selectedModels, setSelectedModels, toggleModel,
    expandedRunId, setExpandedRunId, setActiveRunId,
    selectedUseCaseId, setSelectedUseCaseId,
    handleCancel,
  } = usePanelRunState({
    fetchRuns: fetchArenaRuns,
    fetchResults: fetchArenaResults,
    cancelRun: cancelArena,
    defaultModels: new Set(['haiku', 'sonnet']),
  });

  const useCases = useSelectedUseCases();
  const selectedUseCase = useMemo(
    () => useCases.find((uc) => uc.id === selectedUseCaseId) ?? null,
    [useCases, selectedUseCaseId],
  );

  useEffect(() => {
    if (selectedUseCase?.model_override) {
      const override = selectedUseCase.model_override;
      const match = ALL_MODELS.find((m) => m.provider === override.provider && m.model === override.model);
      if (match) setSelectedModels(new Set([match.id]));
    }
  }, [selectedUseCase, setSelectedModels]);

  const handleStart = async () => {
    if (!selectedPersona || selectedModels.size === 0) return;
    const models = selectedModelsToConfigs(selectedModels);
    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startArena(selectedPersona.id, models, useCaseFilter);
    if (runId) setActiveRunId(runId);
  };
  const handleDelete = async (runId: string) => {
    await deleteArenaRun(runId);
    if (expandedRunId === runId) setExpandedRunId(null);
  };

  const healthCheck = useHealthCheck();
  const hasTools = (selectedPersona?.tools?.length ?? 0) > 0;
  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;
  const toolCount = selectedPersona?.tools?.length ?? 0;

  const contenderCount = selectedModels.size;
  const scenarioCount = selectedUseCaseId && selectedUseCaseId !== '__all__' ? 1 : useCases.length;
  const duelCount = contenderCount * Math.max(scenarioCount, 1);
  const canLaunch = contenderCount > 0 && hasPrompt && !isLabRunning;
  const disabledReason =
    !hasPrompt ? t.agents.lab.add_prompt_first
    : contenderCount === 0 ? t.agents.lab.select_model
    : '';

  const effectiveModel = useMemo(
    () => resolveEffectiveModel(selectedUseCase?.model_override ?? undefined, selectedPersona?.model_profile),
    [selectedUseCase?.model_override, selectedPersona?.model_profile],
  );

  const champion = useMemo(() => computeAllTimeChampion(arenaRuns), [arenaRuns]);

  return (
    <div className="space-y-6">
      {/* Header band */}
      <LedgerHeaderBand
        personaName={selectedPersona?.name ?? null}
        iconToken={selectedPersona?.icon ?? null}
        color={selectedPersona?.color ?? null}
        contenders={contenderCount}
        scenarios={scenarioCount}
        duels={duelCount}
      />

      {/* Two-column body: Setup (left) | Readiness (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4">
        {/* Setup — roster + use case picker */}
        <section className="rounded-card border border-border bg-foreground/[0.015] shadow-elevation-1">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="typo-label text-foreground/70">Setup</span>
            <span className="typo-caption text-foreground/60 tabular-nums">
              {contenderCount}/{ARENA_ROSTER.length} contender{contenderCount === 1 ? '' : 's'}
            </span>
          </div>

          {/* Roster */}
          <div className="p-2 space-y-1">
            {ARENA_ROSTER.map((m) => (
              <LedgerRosterRow
                key={m.id}
                option={m}
                selected={selectedModels.has(m.id)}
                onToggle={() => toggleModel(m.id)}
              />
            ))}
          </div>

          {/* Use case picker */}
          <div className="border-t border-border px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="typo-label text-foreground/70">Use case filter</span>
              <span className="typo-caption text-foreground/60 tabular-nums">
                {scenarioCount}/{useCases.length} scenario{scenarioCount === 1 ? '' : 's'}
              </span>
            </div>
            <LedgerUseCasePicker
              useCases={useCases}
              selectedId={selectedUseCaseId}
              onSelect={setSelectedUseCaseId}
              allLabel={t.agents.lab.all_use_cases}
            />
          </div>
        </section>

        {/* Readiness column */}
        <aside className="rounded-card border border-border bg-foreground/[0.015] shadow-elevation-1 self-start">
          <div className="px-4 py-3 border-b border-border">
            <span className="typo-label text-foreground/70">Readiness</span>
          </div>
          <ul className="p-2 space-y-1">
            <LedgerReadinessRow
              icon={FileCode}
              label="Prompt"
              value={hasPrompt ? (selectedPersona?.structured_prompt ? 'structured' : 'system') : 'missing'}
              tone={hasPrompt ? 'success' : 'error'}
              detail={hasPrompt ? 'battle plan drafted' : t.agents.lab.no_prompt_warning}
            />
            <LedgerReadinessRow
              icon={Wrench}
              label="Tools"
              value={`${toolCount}`}
              tone={hasTools ? 'success' : 'warning'}
              detail={hasTools ? 'connectors linked' : t.agents.lab.no_tools_warning}
            />
            <LedgerReadinessRow
              icon={ShieldCheck}
              label="Trust"
              value={`${selectedPersona?.trust_score ?? 0}`}
              tone={(selectedPersona?.trust_score ?? 0) >= 50 ? 'success' : 'warning'}
              detail={selectedPersona?.trust_level ?? 'unverified'}
            />
            <LedgerReadinessRow
              icon={Crown}
              label="Current model"
              value={effectiveModel.label}
              tone="neutral"
              detail={effectiveModel.source === 'override' ? 'from use-case override'
                : effectiveModel.source === 'persona' ? 'from persona profile'
                : 'arena default'}
            />
            <LedgerReadinessRow
              icon={Target}
              label="Scenarios"
              value={selectedUseCase ? selectedUseCase.title : `${useCases.length}`}
              tone={scenarioCount > 0 ? 'success' : 'warning'}
              detail={scenarioCount > 0 ? 'ready to fight' : 'author a use case first'}
            />
            <LedgerReadinessRow
              icon={Activity}
              label="System"
              value={healthCheck.score ? `${healthCheck.score.value}/100` : '—'}
              tone={
                healthCheck.score?.grade === 'healthy' ? 'success'
                : healthCheck.score?.grade === 'degraded' ? 'warning'
                : healthCheck.score?.grade === 'unhealthy' ? 'error'
                : 'neutral'
              }
              detail={healthCheck.phase === 'done' && healthCheck.score
                ? healthCheck.score.grade
                : 'run health check to populate'}
            />
          </ul>
        </aside>
      </div>

      {/* Advisories */}
      {(!hasPrompt || !hasTools) && (
        <div className="rounded-card border border-status-warning/30 bg-status-warning/10 px-4 py-3 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-status-warning mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p className="typo-body-lg font-medium text-status-warning">Match conditions unmet</p>
            {!hasPrompt && <p className="typo-body-lg text-foreground/85">{t.agents.lab.no_prompt_warning}</p>}
            {!hasTools && <p className="typo-body-lg text-foreground/85">{t.agents.lab.no_tools_warning}</p>}
          </div>
        </div>
      )}

      {/* Launch bar */}
      <LedgerLaunchBar
        isRunning={isLabRunning}
        canLaunch={canLaunch}
        contenders={contenderCount}
        scenarios={scenarioCount}
        duels={duelCount}
        disabledReason={disabledReason}
        onLaunch={() => void handleStart()}
        onCancel={() => void handleCancel()}
        cancelLabel={t.agents.lab.cancel_test}
      />

      {/* Chronicle */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between px-1">
          <h4 className="typo-section-title text-foreground flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" />
            Chronicle
          </h4>
          <span className="typo-caption text-foreground/60">{arenaRuns.length} run{arenaRuns.length === 1 ? '' : 's'} logged</span>
        </div>
        <StandingChampionCard champion={champion} totalRuns={arenaRuns.length} />
        <ArenaHistory
          runs={arenaRuns}
          resultsMap={arenaResultsMap}
          expandedRunId={expandedRunId}
          onToggleExpand={setExpandedRunId}
          onDelete={(id) => void handleDelete(id)}
        />
      </section>
    </div>
  );
}

/* ================================================================== */
/* Subcomponents                                                       */
/* ================================================================== */

function LedgerHeaderBand({
  personaName, iconToken, color, contenders, scenarios, duels,
}: {
  personaName: string | null;
  iconToken: string | null;
  color: string | null;
  contenders: number;
  scenarios: number;
  duels: number;
}) {
  return (
    <div className="rounded-card border border-border bg-foreground/[0.015] shadow-elevation-1">
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="flex items-center justify-center w-11 h-11 rounded-full bg-primary/12 border border-primary/25 flex-shrink-0">
          <PersonaIcon icon={iconToken} color={color} size="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0 leading-tight">
          <p className="typo-label text-primary/70">Arena · Ledger</p>
          <h3 className="typo-submodule-header text-foreground truncate mt-1">
            {personaName ?? 'Select a persona to prepare the ledger'}
          </h3>
        </div>
        <div className="hidden md:flex items-center gap-3 typo-data-lg text-foreground">
          <FormulaPiece n={contenders} label="contenders" />
          <span className="text-foreground/30">×</span>
          <FormulaPiece n={scenarios} label="scenarios" />
          <span className="text-foreground/30">=</span>
          <FormulaPiece n={duels} label="duels" highlight />
        </div>
      </div>
    </div>
  );
}

function FormulaPiece({ n, label, highlight }: { n: number; label: string; highlight?: boolean }) {
  return (
    <span className="flex flex-col items-end leading-none">
      <span className={`typo-data-lg font-bold tabular-nums ${highlight ? 'text-primary' : 'text-foreground'}`}>{n}</span>
      <span className="typo-caption text-foreground/60 mt-0.5">{label}</span>
    </span>
  );
}

function LedgerRosterRow({
  option, selected, onToggle,
}: {
  option: ModelOption;
  selected: boolean;
  onToggle: () => void;
}) {
  const meta = metaFor(option.id, option.provider);
  const Sigil = meta.sigil;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-interactive border transition-colors text-left ${
        selected
          ? 'bg-primary/10 border-primary/35 text-foreground'
          : 'bg-transparent border-transparent text-foreground/80 hover:bg-foreground/[0.03] hover:border-border'
      }`}
    >
      {/* selection box */}
      <span
        aria-hidden
        className={`flex items-center justify-center w-4 h-4 rounded-interactive border flex-shrink-0 ${
          selected ? 'bg-primary border-primary' : 'border-border'
        }`}
      >
        {selected && <Check className="w-3 h-3 text-background" strokeWidth={3} />}
      </span>
      {/* sigil */}
      <span className={`flex items-center justify-center w-8 h-8 rounded-interactive flex-shrink-0 ${
        selected ? 'bg-primary/15 text-primary' : 'bg-foreground/[0.06] text-foreground/70'
      }`}>
        <Sigil className="w-4 h-4" strokeWidth={1.75} />
      </span>
      {/* name + provider */}
      <span className="flex-1 min-w-0">
        <span className="typo-body-lg font-semibold text-foreground truncate block">{option.label}</span>
        <span className="typo-caption text-foreground/60 truncate block">{meta.providerTag}</span>
      </span>
      {/* stats */}
      <span className="flex items-center gap-3 typo-data text-foreground/75 tabular-nums">
        <span className="flex flex-col items-end leading-none">
          <span className="font-semibold">{meta.costLabel}</span>
          <span className="typo-caption text-foreground/55">cost</span>
        </span>
        <span className="flex flex-col items-end leading-none">
          <span className="font-semibold">{meta.speedLabel}</span>
          <span className="typo-caption text-foreground/55">speed</span>
        </span>
      </span>
    </button>
  );
}

type UseCaseLite = { id: string; title: string };
function LedgerUseCasePicker({
  useCases, selectedId, onSelect, allLabel,
}: {
  useCases: UseCaseLite[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  allLabel: string;
}) {
  const effective = selectedId ?? '__all__';
  return (
    <div className="flex flex-wrap gap-1.5">
      <UseCasePill active={effective === '__all__'} onClick={() => onSelect(null)} label={allLabel} />
      {useCases.length === 0 ? (
        <span className="typo-body italic text-foreground/60 px-2 py-1.5">no use cases authored</span>
      ) : (
        useCases.map((uc) => (
          <UseCasePill
            key={uc.id}
            active={uc.id === effective}
            onClick={() => onSelect(uc.id)}
            label={uc.title}
          />
        ))
      )}
    </div>
  );
}

function UseCasePill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`max-w-[200px] truncate px-3 py-1.5 rounded-interactive border typo-body font-medium transition-colors ${
        active
          ? 'bg-primary/15 border-primary/40 text-foreground'
          : 'bg-transparent border-border text-foreground/75 hover:text-foreground hover:border-primary/30'
      }`}
    >
      {label}
    </button>
  );
}

function LedgerReadinessRow({
  icon: Icon, label, value, tone, detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'error' | 'neutral';
  detail: string;
}) {
  const dotClass =
    tone === 'success' ? 'bg-status-success'
    : tone === 'warning' ? 'bg-status-warning'
    : tone === 'error' ? 'bg-status-error'
    : 'bg-status-neutral';
  const valueClass =
    tone === 'success' ? 'text-status-success'
    : tone === 'warning' ? 'text-status-warning'
    : tone === 'error' ? 'text-status-error'
    : 'text-foreground';
  return (
    <li className="flex items-center gap-3 px-3 py-2 rounded-interactive hover:bg-foreground/[0.03] transition-colors">
      <Icon className="w-4 h-4 text-foreground/60 flex-shrink-0" />
      <span className="flex-1 min-w-0 leading-tight">
        <span className="typo-body-lg font-medium text-foreground truncate block">{label}</span>
        <span className="typo-caption text-foreground/60 truncate block">{detail}</span>
      </span>
      <span className="flex items-center gap-1.5 flex-shrink-0">
        <span className={`h-2 w-2 rounded-full ${dotClass}`} />
        <span className={`typo-data font-semibold ${valueClass} truncate max-w-[120px]`} title={value}>
          {value}
        </span>
      </span>
    </li>
  );
}

function LedgerLaunchBar({
  isRunning, canLaunch, contenders, scenarios, duels, disabledReason, onLaunch, onCancel, cancelLabel,
}: {
  isRunning: boolean;
  canLaunch: boolean;
  contenders: number;
  scenarios: number;
  duels: number;
  disabledReason: string;
  onLaunch: () => void;
  onCancel: () => void;
  cancelLabel: string;
}) {
  return (
    <div className="rounded-card border border-border bg-foreground/[0.015] shadow-elevation-2 px-4 py-3 flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${
          isRunning ? 'bg-status-warning animate-pulse'
            : canLaunch ? 'bg-status-success'
            : 'bg-status-neutral'
        }`} />
        <span className="typo-label text-foreground/70">
          {isRunning ? 'Run in progress'
            : canLaunch ? 'Ready to launch'
            : 'Awaiting readiness'}
        </span>
      </div>

      <div className="flex items-center gap-2 typo-body text-foreground/75 tabular-nums">
        <span><span className="font-semibold text-foreground">{contenders}</span> contenders</span>
        <span className="text-foreground/30">×</span>
        <span><span className="font-semibold text-foreground">{scenarios}</span> scenarios</span>
        <span className="text-foreground/30">=</span>
        <span className="text-primary font-semibold">{duels} duels</span>
      </div>

      {!canLaunch && !isRunning && disabledReason && (
        <span className="typo-caption text-status-warning flex items-center gap-1.5">
          <OctagonAlert className="w-3.5 h-3.5" />
          {disabledReason}
        </span>
      )}

      <div className="ml-auto">
        {isRunning ? (
          <button
            onClick={onCancel}
            data-testid="arena-cancel-btn"
            className="flex items-center gap-2 px-4 py-2 rounded-interactive bg-status-error/15 hover:bg-status-error/25 border border-status-error/35 text-status-error typo-body-lg font-medium"
          >
            <Flame className="w-4 h-4" />
            {cancelLabel}
          </button>
        ) : (
          <button
            onClick={onLaunch}
            disabled={!canLaunch}
            data-testid="arena-run-btn"
            className={`flex items-center gap-2 px-5 py-2 rounded-interactive border typo-body-lg font-semibold transition-colors ${
              canLaunch
                ? 'bg-primary/20 hover:bg-primary/30 border-primary/40 text-foreground'
                : 'bg-foreground/[0.04] border-border text-foreground/45 cursor-not-allowed'
            }`}
          >
            <Rocket className="w-4 h-4" />
            Begin the match
            <span className="typo-caption font-normal text-foreground/70 ml-1">× {contenders}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function StandingChampionCard({
  champion, totalRuns,
}: {
  champion: { model: string; wins: number; total: number } | null;
  totalRuns: number;
}) {
  if (!champion) {
    return (
      <div className="rounded-card border border-border bg-foreground/[0.015] px-4 py-3 flex items-center gap-3">
        <Trophy className="w-4 h-4 text-foreground/40" />
        <p className="typo-body-lg italic text-foreground/60">
          No chronicle yet — the first match will crown a champion.
        </p>
      </div>
    );
  }
  const meta = MODEL_META[champion.model] ?? metaFor(champion.model, 'unknown');
  const Sigil = meta.sigil;
  return (
    <div className="rounded-card border border-primary/30 bg-primary/5 shadow-elevation-1 px-4 py-3 flex items-center gap-4">
      <div className="flex items-center justify-center w-11 h-11 rounded-interactive bg-primary/15 border border-primary/30 flex-shrink-0">
        <Sigil className="w-5 h-5 text-primary" strokeWidth={1.75} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="typo-label text-primary/80 flex items-center gap-1.5">
          <Crown className="w-3.5 h-3.5" fill="currentColor" />
          Standing Champion
        </p>
        <p className="typo-section-title text-foreground capitalize mt-1">{champion.model}</p>
        <p className="typo-caption text-foreground/65">
          {champion.wins} victory{champion.wins === 1 ? '' : 'ies'} of {champion.total} judged match{champion.total === 1 ? '' : 'es'}
          {' '}· {totalRuns} run{totalRuns === 1 ? '' : 's'} logged
        </p>
      </div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-foreground/[0.04] border border-border typo-data text-foreground">
        <Swords className="w-3.5 h-3.5 text-primary" />
        <span className="font-semibold tabular-nums">{champion.wins}</span>
        <span className="text-foreground/60">/</span>
        <span className="text-foreground/60 tabular-nums">{champion.total}</span>
      </div>
    </div>
  );
}
