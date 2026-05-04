/**
 * ArenaPanelLedger — directional prototype variant for ArenaPanel.
 *
 * Metaphor: a quiet ledger page. Data-dense single surface, semantic
 * tokens, no SVG scenery. Tightened in round-4 to remove dead space:
 *   - header band shares the run preview and formula tally
 *   - readiness rail trimmed to a one-line-per-row rhythm
 *   - match-preview estimates folded into the launch bar
 *
 * Distinct from Colosseum in mental model:
 *   - Colosseum: spatial, heraldic, one stage with row-card roster
 *   - Ledger:    instrument panel, data-dense, quiet
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
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import { compositeScore, scoreColor } from '@/lib/eval/evalFramework';

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

type ModelStats = { avgScore: number; runs: number; avgCostUsd: number; avgDurationMs: number };

function computeModelStats(resultsMap: Record<string, LabArenaResult[]>): Map<string, ModelStats> {
  const acc = new Map<string, { score: number; cost: number; duration: number; count: number }>();
  for (const results of Object.values(resultsMap)) {
    for (const r of results) {
      const ta = r.toolAccuracyScore ?? 0;
      const oq = r.outputQualityScore ?? 0;
      const pc = r.protocolCompliance ?? 0;
      const comp = compositeScore(ta, oq, pc);
      const cur = acc.get(r.modelId) ?? { score: 0, cost: 0, duration: 0, count: 0 };
      cur.score += comp;
      cur.cost += r.costUsd ?? 0;
      cur.duration += r.durationMs ?? 0;
      cur.count += 1;
      acc.set(r.modelId, cur);
    }
  }
  const out = new Map<string, ModelStats>();
  for (const [id, s] of acc) {
    if (s.count === 0) continue;
    out.set(id, {
      avgScore: Math.round(s.score / s.count),
      runs: s.count,
      avgCostUsd: s.cost / s.count,
      avgDurationMs: s.duration / s.count,
    });
  }
  return out;
}

function computeRecentTrend(runs: LabArenaRun[], resultsMap: Record<string, LabArenaResult[]>, n = 8): number[] {
  const sorted = [...runs].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)).slice(0, n).reverse();
  const out: number[] = [];
  for (const run of sorted) {
    const results = resultsMap[run.id] ?? [];
    let bestModelComp = 0;
    const byModel = new Map<string, { ta: number; oq: number; pc: number; n: number }>();
    for (const r of results) {
      const cur = byModel.get(r.modelId) ?? { ta: 0, oq: 0, pc: 0, n: 0 };
      cur.ta += r.toolAccuracyScore ?? 0;
      cur.oq += r.outputQualityScore ?? 0;
      cur.pc += r.protocolCompliance ?? 0;
      cur.n += 1;
      byModel.set(r.modelId, cur);
    }
    for (const { ta, oq, pc, n: cnt } of byModel.values()) {
      if (cnt === 0) continue;
      const comp = compositeScore(Math.round(ta / cnt), Math.round(oq / cnt), Math.round(pc / cnt));
      if (comp > bestModelComp) bestModelComp = comp;
    }
    if (bestModelComp > 0) out.push(bestModelComp);
  }
  return out;
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
  const modelStats = useMemo(() => computeModelStats(arenaResultsMap), [arenaResultsMap]);
  const recentTrend = useMemo(() => computeRecentTrend(arenaRuns, arenaResultsMap), [arenaRuns, arenaResultsMap]);

  const matchPreview = useMemo(() => {
    let costPerScenario = 0;
    let durationPerScenario = 0;
    let countedModels = 0;
    let knownModels = 0;
    for (const id of selectedModels) {
      const stat = modelStats.get(id);
      if (stat) {
        costPerScenario += stat.avgCostUsd;
        durationPerScenario = Math.max(durationPerScenario, stat.avgDurationMs);
        countedModels += 1;
      }
      knownModels += 1;
    }
    return {
      estCostUsd: costPerScenario * Math.max(scenarioCount, 1),
      estDurationMs: durationPerScenario * Math.max(scenarioCount, 1),
      coveredModels: countedModels,
      totalSelected: knownModels,
    };
  }, [selectedModels, scenarioCount, modelStats]);

  return (
    <div className="space-y-4">
      {/* Header band — persona + ledger label */}
      <LedgerHeaderBand
        personaName={selectedPersona?.name ?? null}
        iconToken={selectedPersona?.icon ?? null}
        color={selectedPersona?.color ?? null}
      />

      {/* Two-column body: Setup (left) | Readiness (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-3">
        {/* Setup — roster + use case picker */}
        <section className="rounded-card border border-border bg-foreground/[0.015] shadow-elevation-1">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="typo-label text-foreground/90">Setup</span>
            <span className="typo-caption text-foreground/90 tabular-nums">
              {contenderCount}/{ARENA_ROSTER.length} contender{contenderCount === 1 ? '' : 's'}
            </span>
          </div>

          {/* Roster */}
          <div className="p-1.5 space-y-0.5">
            {ARENA_ROSTER.map((m) => (
              <LedgerRosterRow
                key={m.id}
                option={m}
                selected={selectedModels.has(m.id)}
                onToggle={() => toggleModel(m.id)}
                stats={modelStats.get(m.id) ?? null}
              />
            ))}
          </div>

          {/* Use case picker */}
          <div className="border-t border-border px-3 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="typo-label text-foreground/90">Use case filter</span>
              <span className="typo-caption text-foreground/90 tabular-nums">
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
          <div className="px-3 py-2 border-b border-border">
            <span className="typo-label text-foreground/90">Readiness</span>
          </div>
          <ul className="p-1.5 space-y-0.5">
            <LedgerReadinessRow
              icon={FileCode}
              label="Prompt"
              value={hasPrompt ? (selectedPersona?.structured_prompt ? 'structured' : 'system') : 'missing'}
              tone={hasPrompt ? 'success' : 'error'}
            />
            <LedgerReadinessRow
              icon={Wrench}
              label="Tools"
              value={`${toolCount}`}
              tone={hasTools ? 'success' : 'warning'}
            />
            <LedgerReadinessRow
              icon={ShieldCheck}
              label="Trust"
              value={`${selectedPersona?.trust_score ?? 0} · ${selectedPersona?.trust_level ?? 'unverified'}`}
              tone={(selectedPersona?.trust_score ?? 0) >= 50 ? 'success' : 'warning'}
            />
            <LedgerReadinessRow
              icon={Crown}
              label="Model"
              value={effectiveModel.label}
              tone="neutral"
            />
            <LedgerReadinessRow
              icon={Target}
              label="Scenarios"
              value={selectedUseCase ? selectedUseCase.title : `${useCases.length} all`}
              tone={scenarioCount > 0 ? 'success' : 'warning'}
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
            />
          </ul>
        </aside>
      </div>

      {/* Advisories */}
      {(!hasPrompt || !hasTools) && (
        <div className="rounded-card border border-status-warning/30 bg-status-warning/10 px-3 py-2 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-status-warning mt-0.5 flex-shrink-0" />
          <div className="space-y-0.5">
            <p className="typo-body-lg font-medium text-status-warning">Match conditions unmet</p>
            {!hasPrompt && <p className="typo-body text-foreground">{t.agents.lab.no_prompt_warning}</p>}
            {!hasTools && <p className="typo-body text-foreground">{t.agents.lab.no_tools_warning}</p>}
          </div>
        </div>
      )}

      {/* Launch bar — formula + estimates + CTA on a single row */}
      <LedgerLaunchBar
        isRunning={isLabRunning}
        canLaunch={canLaunch}
        contenders={contenderCount}
        scenarios={scenarioCount}
        duels={duelCount}
        estCostUsd={matchPreview.estCostUsd}
        estDurationMs={matchPreview.estDurationMs}
        coveredModels={matchPreview.coveredModels}
        totalSelected={matchPreview.totalSelected}
        disabledReason={disabledReason}
        onLaunch={() => void handleStart()}
        onCancel={() => void handleCancel()}
        cancelLabel={t.agents.lab.cancel_test}
      />

      {/* Chronicle */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between px-1">
          <h4 className="typo-section-title text-foreground flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" />
            Chronicle
          </h4>
          <span className="typo-caption text-foreground/90">{arenaRuns.length} run{arenaRuns.length === 1 ? '' : 's'} logged</span>
        </div>
        <ChronicleTrend trend={recentTrend} />
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
  personaName, iconToken, color,
}: {
  personaName: string | null;
  iconToken: string | null;
  color: string | null;
}) {
  return (
    <div className="rounded-card border border-border bg-foreground/[0.015] shadow-elevation-1 px-4 py-2.5 flex items-center gap-3">
      <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/12 border border-primary/25 flex-shrink-0">
        <PersonaIcon icon={iconToken} color={color} size="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0 leading-tight">
        <p className="typo-label text-primary/70">Arena · Ledger</p>
        <h3 className="typo-section-title text-foreground truncate mt-0.5">
          {personaName ?? 'Select a persona to prepare the ledger'}
        </h3>
      </div>
    </div>
  );
}

function LedgerRosterRow({
  option, selected, onToggle, stats,
}: {
  option: ModelOption;
  selected: boolean;
  onToggle: () => void;
  stats: ModelStats | null;
}) {
  const meta = metaFor(option.id, option.provider);
  const Sigil = meta.sigil;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-interactive border transition-colors text-left ${
        selected
          ? 'bg-primary/10 border-primary/35 text-foreground'
          : 'bg-transparent border-transparent text-foreground hover:bg-foreground/[0.03] hover:border-border'
      }`}
    >
      <span
        aria-hidden
        className={`flex items-center justify-center w-4 h-4 rounded-interactive border flex-shrink-0 ${
          selected ? 'bg-primary border-primary' : 'border-border'
        }`}
      >
        {selected && <Check className="w-3 h-3 text-background" strokeWidth={3} />}
      </span>
      <span className={`flex items-center justify-center w-7 h-7 rounded-interactive flex-shrink-0 ${
        selected ? 'bg-primary/15 text-primary' : 'bg-foreground/[0.06] text-foreground/90'
      }`}>
        <Sigil className="w-4 h-4" strokeWidth={1.75} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="typo-body font-semibold text-foreground truncate block">{option.label}</span>
        <span className="typo-caption text-foreground/85 truncate block">{meta.providerTag}</span>
      </span>
      {/* Track record */}
      <span className="flex items-baseline gap-1 typo-data tabular-nums flex-shrink-0">
        {stats ? (
          <>
            <span className={`font-bold ${scoreColor(stats.avgScore)}`}>{stats.avgScore}</span>
            <span className="typo-caption text-foreground/85">· {stats.runs}</span>
          </>
        ) : (
          <span className="typo-caption text-foreground/85">unproven</span>
        )}
      </span>
      {/* Tier shorthand — single inline row */}
      <span className="flex items-center gap-2 typo-caption text-foreground/85 tabular-nums flex-shrink-0">
        <span className="font-semibold text-foreground">{meta.costLabel}</span>
        <span className="text-foreground/30">·</span>
        <span className="font-semibold text-foreground">{meta.speedLabel}</span>
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
    <div className="flex flex-wrap gap-1">
      <UseCasePill active={effective === '__all__'} onClick={() => onSelect(null)} label={allLabel} />
      {useCases.length === 0 ? (
        <span className="typo-body italic text-foreground/85 px-2 py-1">no use cases authored</span>
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
      className={`max-w-[200px] truncate px-2.5 py-1 rounded-interactive border typo-body font-medium transition-colors ${
        active
          ? 'bg-primary/15 border-primary/40 text-foreground'
          : 'bg-transparent border-border text-foreground/90 hover:text-foreground hover:border-primary/30'
      }`}
    >
      {label}
    </button>
  );
}

function LedgerReadinessRow({
  icon: Icon, label, value, tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'error' | 'neutral';
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
    <li className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-interactive hover:bg-foreground/[0.03] transition-colors">
      <Icon className="w-3.5 h-3.5 text-foreground/85 flex-shrink-0" />
      <span className="typo-body font-medium text-foreground flex-shrink-0">{label}</span>
      <span className="flex-1 min-w-0" />
      <span className={`h-2 w-2 rounded-full ${dotClass} flex-shrink-0`} />
      <span className={`typo-data font-semibold ${valueClass} truncate max-w-[150px]`} title={value}>
        {value}
      </span>
    </li>
  );
}

function LedgerLaunchBar({
  isRunning, canLaunch, contenders, scenarios, duels,
  estCostUsd, estDurationMs, coveredModels, totalSelected,
  disabledReason, onLaunch, onCancel, cancelLabel,
}: {
  isRunning: boolean;
  canLaunch: boolean;
  contenders: number;
  scenarios: number;
  duels: number;
  estCostUsd: number;
  estDurationMs: number;
  coveredModels: number;
  totalSelected: number;
  disabledReason: string;
  onLaunch: () => void;
  onCancel: () => void;
  cancelLabel: string;
}) {
  const hasEstimate = coveredModels > 0;
  const partial = hasEstimate && coveredModels < totalSelected;
  return (
    <div className="rounded-card border border-border bg-foreground/[0.015] shadow-elevation-2 px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${
          isRunning ? 'bg-status-warning animate-pulse'
            : canLaunch ? 'bg-status-success'
            : 'bg-status-neutral'
        }`} />
        <span className="typo-label text-foreground/90">
          {isRunning ? 'Running'
            : canLaunch ? 'Ready'
            : 'Awaiting'}
        </span>
      </div>

      <div className="flex items-center gap-1.5 typo-body text-foreground/90 tabular-nums">
        <span><span className="font-semibold text-foreground">{contenders}</span> ×</span>
        <span><span className="font-semibold text-foreground">{scenarios}</span> =</span>
        <span className="text-primary font-semibold">{duels} duels</span>
      </div>

      <div className="flex items-center gap-2 typo-caption text-foreground/85 tabular-nums" title={partial ? `partial — ${coveredModels}/${totalSelected} models have history` : undefined}>
        <span>~ {hasEstimate ? formatDuration(estDurationMs) : '—'}</span>
        <span className="text-foreground/30">·</span>
        <span>{hasEstimate ? formatCostUsd(estCostUsd) : '—'}</span>
        {partial && <span className="text-foreground/55">(partial)</span>}
      </div>

      {!canLaunch && !isRunning && disabledReason && (
        <span className="typo-caption text-status-warning flex items-center gap-1">
          <OctagonAlert className="w-3.5 h-3.5" />
          {disabledReason}
        </span>
      )}

      <div className="ml-auto">
        {isRunning ? (
          <button
            onClick={onCancel}
            data-testid="arena-cancel-btn"
            className="flex items-center gap-2 px-4 py-1.5 rounded-interactive bg-status-error/15 hover:bg-status-error/25 border border-status-error/35 text-status-error typo-body font-medium"
          >
            <Flame className="w-4 h-4" />
            {cancelLabel}
          </button>
        ) : (
          <button
            onClick={onLaunch}
            disabled={!canLaunch}
            data-testid="arena-run-btn"
            className={`flex items-center gap-2 px-4 py-1.5 rounded-interactive border typo-body font-semibold transition-colors ${
              canLaunch
                ? 'bg-primary/20 hover:bg-primary/30 border-primary/40 text-foreground'
                : 'bg-foreground/[0.04] border-border text-foreground cursor-not-allowed'
            }`}
          >
            <Rocket className="w-4 h-4" />
            Begin the match
            <span className="typo-caption font-normal text-foreground/90 ml-1">× {contenders}</span>
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
      <div className="rounded-card border border-border bg-foreground/[0.015] px-3 py-2 flex items-center gap-2.5">
        <Trophy className="w-4 h-4 text-foreground" />
        <p className="typo-body italic text-foreground/85">
          No chronicle yet — the first match will crown a champion.
        </p>
      </div>
    );
  }
  const meta = MODEL_META[champion.model] ?? metaFor(champion.model, 'unknown');
  const Sigil = meta.sigil;
  return (
    <div className="rounded-card border border-primary/30 bg-primary/5 shadow-elevation-1 px-3 py-2 flex items-center gap-3">
      <div className="flex items-center justify-center w-9 h-9 rounded-interactive bg-primary/15 border border-primary/30 flex-shrink-0">
        <Sigil className="w-4 h-4 text-primary" strokeWidth={1.75} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="typo-label text-primary/80 flex items-center gap-1.5">
          <Crown className="w-3 h-3" fill="currentColor" />
          Standing Champion
        </p>
        <p className="typo-body-lg font-semibold text-foreground capitalize truncate">
          {champion.model}
          <span className="typo-caption text-foreground/85 font-normal ml-1.5">
            · {champion.wins}/{champion.total} judged · {totalRuns} run{totalRuns === 1 ? '' : 's'}
          </span>
        </p>
      </div>
      <div className="flex items-center gap-1 px-2 py-1 rounded-interactive bg-foreground/[0.04] border border-border typo-data text-foreground flex-shrink-0">
        <Swords className="w-3.5 h-3.5 text-primary" />
        <span className="font-semibold tabular-nums">{champion.wins}</span>
        <span className="text-foreground/90">/</span>
        <span className="text-foreground/90 tabular-nums">{champion.total}</span>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `~${sec}s`;
  const min = Math.round(sec / 60);
  return `~${min}m`;
}

function formatCostUsd(usd: number): string {
  if (usd <= 0) return '—';
  if (usd < 0.01) return '<$0.01';
  if (usd < 1)    return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function ChronicleTrend({ trend }: { trend: number[] }) {
  if (trend.length < 2) return null;
  const w = 220;
  const h = 28;
  const pad = 2;
  const max = Math.max(...trend, 100);
  const min = Math.min(...trend, 0);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / Math.max(trend.length - 1, 1);
  const pts = trend.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });
  const polyline = pts.join(' ');
  const last = trend[trend.length - 1] ?? 0;
  const first = trend[0] ?? 0;
  const delta = last - first;
  const deltaLabel = delta >= 0 ? `+${delta}` : `${delta}`;
  return (
    <div className="rounded-card border border-border bg-foreground/[0.015] px-3 py-2 flex items-center gap-3">
      <span className="typo-label text-foreground/90 flex-shrink-0">
        Trend · {trend.length}
      </span>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="flex-1 h-7 max-w-[260px] text-primary"
        aria-label="Recent winning composite scores"
      >
        <polyline
          points={polyline}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {pts.map((p, i) => {
          const [x, y] = p.split(',').map(Number);
          const isLast = i === pts.length - 1;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={isLast ? 3 : 1.75}
              fill="currentColor"
              opacity={isLast ? 1 : 0.6}
            />
          );
        })}
      </svg>
      <div className="flex items-baseline gap-2 flex-shrink-0 tabular-nums">
        <span className={`typo-data-lg ${scoreColor(last)}`}>{last}</span>
        <span className={`typo-caption ${delta >= 0 ? 'text-status-success' : 'text-status-warning'}`}>
          {deltaLabel}
        </span>
      </div>
    </div>
  );
}
