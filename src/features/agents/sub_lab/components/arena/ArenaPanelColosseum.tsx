/**
 * ArenaPanelColosseum — directional prototype variant for ArenaPanel.
 *
 * Round-4 layout:
 *
 *   ┌─[marquee with torches + clickable use-case popover]─────────────┐
 *   │ [persona standard]    [roster grid of row cards]    [conditions]│
 *   │      (left)                  (center)                   (right) │
 *   └─[formula bar + "Begin the Match"]──────────────────────────────┘
 *
 * The arc-of-banners has been retired in favour of a row-composed roster
 * grid: each contender is a card with its sigil rendered as a semi-
 * transparent backdrop, the model title prominent, and double-size
 * cost/speed pips. The scheme scales to many more models without the
 * arc collapsing. Use case selection now lives on the marquee subtitle
 * as a popover (no more left "Ground" rail).
 */

import { useEffect, useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle, Shield, Flame, Trophy, Swords, Sparkles, Crown, Scroll,
  ScrollText, BookOpen, Zap, Cloud, HardDrive, Medal, Circle, Coins,
  Sword, Feather, ChevronDown, Check,
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
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { resolveEffectiveModel } from '@/features/agents/sub_use_cases/libs/useCaseDetailHelpers';
import type { LabArenaRun } from '@/lib/bindings/LabArenaRun';

/* ------------------------------------------------------------------ */
/* Model heraldry — sigils + cost/speed pips                          */
/* ------------------------------------------------------------------ */

type ModelHeraldry = {
  sigil: LucideIcon;
  cost: 1 | 2 | 3;
  speed: 1 | 2 | 3;
  houseIcon: LucideIcon;
  houseName: string;
};

const HERALDRY: Record<string, ModelHeraldry> = {
  haiku:  { sigil: Zap,        cost: 1, speed: 3, houseIcon: Sparkles, houseName: 'Anthropic' },
  sonnet: { sigil: ScrollText, cost: 2, speed: 2, houseIcon: Sparkles, houseName: 'Anthropic' },
  opus:   { sigil: BookOpen,   cost: 3, speed: 1, houseIcon: Sparkles, houseName: 'Anthropic' },
};

function heraldryFor(id: string, provider: string): ModelHeraldry {
  const known = HERALDRY[id];
  if (known) return known;
  if (provider === 'ollama') {
    const isLocal = id.startsWith('ollama:');
    return {
      sigil: isLocal ? HardDrive : Cloud,
      cost: 1,
      speed: 2,
      houseIcon: isLocal ? HardDrive : Cloud,
      houseName: isLocal ? 'Ollama Local' : 'Ollama Cloud',
    };
  }
  return { sigil: Sword, cost: 2, speed: 2, houseIcon: Shield, houseName: provider };
}

const ARENA_ROSTER: ModelOption[] = [...ANTHROPIC_MODELS, ...OLLAMA_LOCAL_MODELS];

/* ------------------------------------------------------------------ */
/* All-time champion derived from past runs                           */
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
/* Main component                                                      */
/* ================================================================== */

export function ArenaPanelColosseum() {
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
  const championModel = useMemo(() => {
    const match = ALL_MODELS.find(
      (m) => m.provider === effectiveModel.profile.provider && m.model === effectiveModel.profile.model,
    );
    if (match) return { option: match, heraldry: heraldryFor(match.id, match.provider) };
    const fallback: ModelOption = {
      id: effectiveModel.label || 'custom',
      label: effectiveModel.label,
      provider: effectiveModel.profile.provider || 'anthropic',
      model: effectiveModel.profile.model,
    };
    return { option: fallback, heraldry: heraldryFor(fallback.id, fallback.provider) };
  }, [effectiveModel]);

  const champion = useMemo(() => computeAllTimeChampion(arenaRuns), [arenaRuns]);

  return (
    <div className="space-y-8">
      {/* ── ACT I : THE STAGE ────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-modal border border-primary/20 bg-gradient-to-b from-secondary/35 via-background/40 to-background/25">
        <Torch side="left"  lit={canLaunch} />
        <Torch side="right" lit={canLaunch} />

        <ArenaMarquee
          personaName={selectedPersona?.name}
          selectedUseCase={selectedUseCase}
          useCases={useCases}
          onSelectUseCase={setSelectedUseCaseId}
          allLabel={t.agents.lab.all_use_cases}
          ready={canLaunch}
        />

        {/* Stage body: 3-column [persona | roster grid | conditions] */}
        <div className="relative px-4 sm:px-6 pb-5 pt-2 grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_200px] gap-4">
          {/* LEFT : persona standard */}
          <div className="flex justify-center lg:justify-start lg:pt-2">
            <PersonaStandard
              name={selectedPersona?.name ?? null}
              trustScore={selectedPersona?.trust_score ?? 0}
              hasPrompt={hasPrompt}
              toolCount={toolCount}
              iconToken={selectedPersona?.icon ?? null}
              color={selectedPersona?.color ?? null}
            />
          </div>

          {/* CENTER : Roster grid — row cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 content-start">
            {ARENA_ROSTER.map((m) => {
              const isSelected = selectedModels.has(m.id);
              const heraldry = heraldryFor(m.id, m.provider);
              return (
                <ModelRowCard
                  key={m.id}
                  option={m}
                  selected={isSelected}
                  heraldry={heraldry}
                  onToggle={() => toggleModel(m.id)}
                />
              );
            })}
          </div>

          {/* RIGHT : match conditions list */}
          <ConditionsList
            hasPrompt={hasPrompt}
            hasTools={hasTools}
            toolCount={toolCount}
            trustScore={selectedPersona?.trust_score ?? 0}
            trustLevel={selectedPersona?.trust_level ?? 'unverified'}
            scenarioCount={scenarioCount}
          />
        </div>

        {/* Stage base: formula + launch */}
        <div className="relative border-t border-primary/15 bg-background/40 px-4 sm:px-6 py-4 flex flex-wrap items-center gap-4">
          <MatchFormula
            contenders={contenderCount}
            scenarios={scenarioCount}
            duels={duelCount}
          />
          <div className="ml-auto flex items-center gap-3">
            {isLabRunning ? (
              <button
                onClick={() => void handleCancel()}
                data-testid="arena-cancel-btn"
                className="flex items-center gap-2 px-5 py-2.5 rounded-modal bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 typo-body-lg font-medium transition-colors"
              >
                <Flame className="w-4 h-4" />
                {t.agents.lab.cancel_test}
              </button>
            ) : (
              <WaxSealButton
                canLaunch={canLaunch}
                contenders={contenderCount}
                disabledReason={disabledReason}
                onLaunch={() => void handleStart()}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── ACT II : MATCH BLUEPRINT ─────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          icon={Feather}
          eyebrow="Act II"
          title="Match Blueprint"
          subtitle="what enters the arena"
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Contenders */}
          <ParchmentCard title="Contenders" meta={`${contenderCount} selected`} icon={Swords}>
            {contenderCount === 0 ? (
              <EmptyLine>No contenders drawn</EmptyLine>
            ) : (
              <ul className="space-y-2">
                {ARENA_ROSTER
                  .filter((m) => selectedModels.has(m.id))
                  .map((m) => {
                    const h = heraldryFor(m.id, m.provider);
                    const Sigil = h.sigil;
                    return (
                      <li key={m.id} className="flex items-center gap-2">
                        <span className="flex items-center justify-center w-7 h-7 rounded-card border border-primary/25 bg-primary/10">
                          <Sigil className="w-4 h-4 text-primary" strokeWidth={1.75} />
                        </span>
                        <span className="flex-1 min-w-0 typo-body-lg font-medium text-foreground truncate">
                          {m.label}
                        </span>
                        <StatPips label="cost" level={h.cost} icon={Coins} />
                        <StatPips label="speed" level={h.speed} icon={Zap} />
                      </li>
                    );
                  })}
              </ul>
            )}
          </ParchmentCard>

          {/* Arena (use cases summary) */}
          <ParchmentCard
            title="Arena"
            meta={`${scenarioCount} scenario${scenarioCount === 1 ? '' : 's'}`}
            icon={Scroll}
          >
            <div className="space-y-2">
              <div>
                {selectedUseCase ? (
                  <>
                    <span className="typo-label text-primary/70">Chosen ground</span>
                    <p className="typo-body-lg font-medium text-foreground mt-1">{selectedUseCase.title}</p>
                  </>
                ) : useCases.length > 0 ? (
                  <>
                    <span className="typo-label text-primary/70">All grounds</span>
                    <p className="typo-body-lg text-foreground mt-1">
                      Every authored use case will be fought.
                    </p>
                  </>
                ) : (
                  <EmptyLine>No use cases authored — the match will run on defaults.</EmptyLine>
                )}
              </div>
              <div className="pt-2 border-t border-primary/10 typo-body text-foreground/90">
                <span className="flex items-center gap-1.5">
                  <Circle className="w-2 h-2 fill-current" />
                  {useCases.length} total use case{useCases.length === 1 ? '' : 's'} on file
                </span>
              </div>
            </div>
          </ParchmentCard>

          {/* Champion (persona's effective model) */}
          <ChampionCard
            modelLabel={championModel.option.label}
            heraldry={championModel.heraldry}
            sourceLabel={
              effectiveModel.source === 'override' ? 'from use-case override' :
              effectiveModel.source === 'persona'  ? 'from persona profile' :
              'arena default'
            }
            personaName={selectedPersona?.name ?? null}
            iconToken={selectedPersona?.icon ?? null}
            color={selectedPersona?.color ?? null}
          />
        </div>
      </section>

      {/* Prompt/tool advisories */}
      {(!hasPrompt || !hasTools) && (
        <div className="rounded-modal border border-amber-500/25 bg-amber-500/[0.05] px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="space-y-1 text-foreground/90">
            <p className="typo-body-lg font-medium text-amber-300">Match conditions unmet</p>
            {!hasPrompt && <p className="typo-body-lg">{t.agents.lab.no_prompt_warning}</p>}
            {!hasTools && <p className="typo-body-lg">{t.agents.lab.no_tools_warning}</p>}
          </div>
        </div>
      )}

      {/* ── ACT III : THE CHRONICLE ──────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          icon={Scroll}
          eyebrow="Act III"
          title="The Chronicle"
          subtitle="what the matches remember"
        />
        <StandingChampionBanner champion={champion} totalRuns={arenaRuns.length} />
        <ArenaHistory
          runs={arenaRuns}
          resultsMap={arenaResultsMap}
          expandedRunId={expandedRunId}
          onToggleExpand={setExpandedRunId}
          onDelete={(id) => void handleDelete(id)}
        />
      </section>

      {/* Status foot */}
      <div className="flex items-center justify-center gap-2 typo-body text-foreground/85 pt-2">
        <Medal className="w-3.5 h-3.5" />
        {healthCheck.phase === 'idle' && <span>Systems on standby — run a health check to illuminate</span>}
        {healthCheck.phase === 'running' && <span>The herald sweeps the field…</span>}
        {healthCheck.phase === 'done' && healthCheck.score && (
          <span>Systems at {healthCheck.score.value}/100 · {healthCheck.score.grade}</span>
        )}
        {healthCheck.phase === 'error' && <span>Herald fell silent — health check unavailable</span>}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Stage header — marquee + use-case popover                           */
/* ================================================================== */

type UseCaseLite = { id: string; title: string };

function ArenaMarquee({
  personaName, selectedUseCase, useCases, onSelectUseCase, allLabel, ready,
}: {
  personaName: string | undefined;
  selectedUseCase: UseCaseLite | null;
  useCases: UseCaseLite[];
  onSelectUseCase: (id: string | null) => void;
  allLabel: string;
  ready: boolean;
}) {
  return (
    <div className="relative px-16 pt-6 pb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-1.5 text-primary flex-shrink-0">
          <Swords className="w-5 h-5" />
          <Flame className={`w-4 h-4 ${ready ? 'text-amber-300' : 'text-foreground'}`} fill="currentColor" strokeWidth={1.25} />
        </div>
        <div className="min-w-0">
          <h3 className="typo-heading-lg font-semibold text-foreground tracking-wide">The Arena</h3>
          <p className="typo-body-lg text-foreground flex flex-wrap items-center gap-1">
            {personaName ? (
              <>
                <span>A trial for</span>
                <span className="text-foreground font-medium">{personaName}</span>
                <span>—</span>
                <UseCasePopover
                  selectedUseCase={selectedUseCase}
                  useCases={useCases}
                  onSelect={onSelectUseCase}
                  allLabel={allLabel}
                />
              </>
            ) : (
              <span>Select a persona to open the gates</span>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-4 w-3 bg-gradient-to-b from-primary/40 to-primary/10 border-x border-primary/30"
            style={{ clipPath: 'polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%)' }}
            aria-hidden
          />
        ))}
      </div>
    </div>
  );
}

function UseCasePopover({
  selectedUseCase, useCases, onSelect, allLabel,
}: {
  selectedUseCase: UseCaseLite | null;
  useCases: UseCaseLite[];
  onSelect: (id: string | null) => void;
  allLabel: string;
}) {
  const label = selectedUseCase?.title ?? allLabel;
  const options = useMemo(
    () => [{ value: '__all__', label: allLabel }, ...useCases.map((uc) => ({ value: uc.id, label: uc.title }))],
    [allLabel, useCases],
  );
  const activeValue = selectedUseCase?.id ?? '__all__';

  return (
    <Listbox
      itemCount={options.length}
      onSelectFocused={(idx) => {
        const opt = options[idx];
        if (opt) onSelect(opt.value === '__all__' ? null : opt.value);
      }}
      ariaLabel="Select use case"
      renderTrigger={({ isOpen, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          data-testid="arena-usecase-popover-trigger"
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive italic transition-colors border focus-ring ${
            isOpen
              ? 'bg-primary/15 border-primary/35 text-primary'
              : 'bg-primary/5 border-primary/20 text-primary/85 hover:bg-primary/10 hover:text-primary'
          }`}
        >
          <span className="truncate max-w-[220px]">{label}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {({ close, focusIndex }) => (
        <div className="py-1 bg-background border border-primary/20 rounded-card shadow-elevation-3 mt-1 max-h-60 overflow-y-auto min-w-[240px]">
          {options.map((opt, i) => {
            const active = opt.value === activeValue;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onSelect(opt.value === '__all__' ? null : opt.value);
                  close();
                }}
                className={`w-full text-left px-3 py-1.5 typo-body transition-colors ${
                  focusIndex === i ? 'bg-primary/15' : ''
                } ${
                  active ? 'text-primary font-medium' : 'text-foreground hover:bg-secondary/30'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </Listbox>
  );
}

function Torch({ side, lit }: { side: 'left' | 'right'; lit: boolean }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute top-4 z-20 ${side === 'left' ? 'left-4' : 'right-4'} flex flex-col items-center gap-1`}
    >
      <div className="relative h-11 w-8">
        {lit && (
          <div className="absolute inset-x-0 -top-1 h-10 rounded-full bg-gradient-to-t from-amber-400/50 via-amber-300/35 to-transparent blur-[6px]" />
        )}
        <Flame
          className={`absolute inset-0 m-auto w-7 h-7 ${lit ? 'text-amber-300' : 'text-foreground/30'}`}
          strokeWidth={1.5}
          fill="currentColor"
        />
      </div>
      <div className="h-10 w-2.5 rounded-b-sm bg-gradient-to-b from-primary/40 via-primary/20 to-primary/5 border-x border-primary/20" />
      <div className="h-1 w-5 rounded-sm bg-primary/30" />
    </div>
  );
}

/* ================================================================== */
/* Persona standard                                                    */
/* ================================================================== */

function PersonaStandard({
  name, trustScore, hasPrompt, toolCount, iconToken, color,
}: {
  name: string | null;
  trustScore: number;
  hasPrompt: boolean;
  toolCount: number;
  iconToken: string | null;
  color: string | null;
}) {
  const arrayed = hasPrompt && toolCount > 0;
  return (
    <div className="flex flex-col items-center gap-0">
      <Crown
        className={`w-6 h-6 ${arrayed ? 'text-primary' : 'text-foreground'} -mb-0.5`}
        strokeWidth={1.5}
        fill="currentColor"
      />
      <div className="h-2.5 w-0.5 bg-primary/50" />

      {/* Banner body */}
      <div
        className={`relative w-[168px] border-x-2 ${
          arrayed ? 'border-primary/55' : 'border-primary/25'
        } bg-gradient-to-b ${
          arrayed ? 'from-primary/35 via-primary/22 to-primary/8' : 'from-secondary/65 via-secondary/45 to-secondary/25'
        } px-3 pt-4 pb-8 shadow-elevation-3 shadow-primary/10`}
        style={{ clipPath: 'polygon(0 0, 100% 0, 100% 88%, 50% 100%, 0 88%)' }}
      >
        <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center border-2 ${
          arrayed ? 'border-primary/65 shadow-inner' : 'border-primary/25'
        } bg-gradient-to-br from-background/80 to-background/40`}>
          <PersonaIcon icon={iconToken} color={color} size="w-8 h-8" />
        </div>
        <p className="typo-body-lg font-semibold text-foreground mt-2.5 text-center truncate">
          {name ?? '—'}
        </p>
        <p className="typo-label text-primary/85 text-center mt-0.5 tracking-widest uppercase">
          Champion
        </p>
      </div>

      {/* Stone plinth base */}
      <div className="relative -mt-0.5 flex flex-col items-center">
        <div className={`h-1.5 w-[188px] rounded-sm bg-gradient-to-r from-primary/10 via-primary/30 to-primary/10 border-x border-primary/20`} />
        <div className={`h-3 w-[172px] bg-gradient-to-b from-primary/15 to-primary/[0.02] border-x border-primary/15 border-b border-primary/10`} />
        <div className="h-1 w-[150px] rounded-full bg-primary/12 blur-sm mt-0.5" />
      </div>

      <div className="mt-2 flex items-center gap-1 rounded-full border border-primary/30 bg-background/75 px-3 py-0.5 typo-body text-foreground">
        <Shield className="w-3.5 h-3.5 text-primary" />
        <span className="font-semibold">{trustScore}</span>
        <span className="text-foreground/90">trust</span>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Model row card — sigil-as-backdrop, big stats                       */
/* ================================================================== */

function ModelRowCard({
  option, selected, heraldry, onToggle,
}: {
  option: ModelOption;
  selected: boolean;
  heraldry: ModelHeraldry;
  onToggle: () => void;
}) {
  const Sigil = heraldry.sigil;
  const HouseIcon = heraldry.houseIcon;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      data-testid={`arena-model-card-${option.id}`}
      className={`relative overflow-hidden rounded-card border-2 px-3.5 py-3 text-left transition-all focus-ring ${
        selected
          ? 'bg-primary/15 border-primary/55 shadow-elevation-3 shadow-primary/15'
          : 'bg-secondary/40 border-primary/20 hover:bg-secondary/60 hover:border-primary/40 hover:shadow-elevation-2'
      }`}
    >
      {/* Sigil — semi-transparent backdrop */}
      <Sigil
        aria-hidden
        className={`pointer-events-none absolute -right-3 -bottom-3 w-24 h-24 transition-colors ${
          selected ? 'text-primary/20' : 'text-foreground/[0.06]'
        }`}
        strokeWidth={1}
      />

      {/* Selected check */}
      {selected && (
        <span
          aria-hidden
          className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow-[0_0_8px_rgba(var(--color-primary-rgb,180,140,255),0.6)]"
        >
          <Check className="w-3 h-3 text-background" strokeWidth={3} />
        </span>
      )}

      {/* House tag */}
      <div className="relative flex items-center gap-1.5 typo-label text-foreground/75">
        <HouseIcon className="w-3 h-3" strokeWidth={1.75} />
        <span className="truncate">{heraldry.houseName}</span>
      </div>

      {/* Model name */}
      <p className="relative typo-heading text-foreground font-semibold mt-1 truncate">
        {option.label}
      </p>

      {/* Stats — double-size pips for cost & speed */}
      <div className="relative mt-3 flex items-center gap-4">
        <BigStatPips label="cost"  level={heraldry.cost}  icon={Coins} active={selected} />
        <span className={`h-5 w-px ${selected ? 'bg-primary/45' : 'bg-foreground/20'}`} aria-hidden />
        <BigStatPips label="speed" level={heraldry.speed} icon={Zap}   active={selected} />
      </div>
    </button>
  );
}

function BigStatPips({
  label, level, icon: Icon, active,
}: { label: string; level: number; icon: LucideIcon; active: boolean }) {
  return (
    <span className="flex flex-col gap-1 leading-none" title={`${label}: ${level}/3`}>
      <span className="flex items-center gap-1.5">
        <Icon className={`w-5 h-5 ${active ? 'text-primary' : 'text-foreground/85'}`} strokeWidth={1.75} />
        <span className="flex items-center gap-1">
          {[1, 2, 3].map((i) => (
            <span
              key={i}
              className={`inline-block w-3 h-3 rounded-full ${
                i <= level
                  ? active ? 'bg-primary' : 'bg-foreground/85'
                  : active ? 'bg-primary/25' : 'bg-foreground/15'
              }`}
            />
          ))}
        </span>
      </span>
      <span className="typo-label text-foreground/75 uppercase tracking-wider">{label}</span>
    </span>
  );
}

/* ================================================================== */
/* Conditions rail                                                     */
/* ================================================================== */

function ConditionsList({
  hasPrompt, hasTools, toolCount, trustScore, trustLevel, scenarioCount,
}: {
  hasPrompt: boolean;
  hasTools: boolean;
  toolCount: number;
  trustScore: number;
  trustLevel: string;
  scenarioCount: number;
}) {
  return (
    <aside className="rounded-card border border-primary/20 bg-background/50 backdrop-blur-sm self-start">
      <div className="px-3 py-2 border-b border-primary/15">
        <span className="typo-label text-primary/80">Conditions</span>
      </div>
      <ul className="p-2 space-y-1">
        <ConditionRow tone={hasPrompt ? 'ok' : 'warn'} label={hasPrompt ? 'Battle plan drawn' : 'No battle plan'} />
        <ConditionRow
          tone={hasTools ? 'ok' : 'warn'}
          label={hasTools ? `${toolCount} tool${toolCount === 1 ? '' : 's'} equipped` : 'Unarmed'}
        />
        <ConditionRow tone="neutral" label={`Trust ${trustScore} · ${trustLevel}`} />
        <ConditionRow
          tone={scenarioCount > 0 ? 'ok' : 'warn'}
          label={scenarioCount > 0 ? `${scenarioCount} scenario${scenarioCount === 1 ? '' : 's'} ready` : 'No scenarios'}
        />
      </ul>
    </aside>
  );
}

function ConditionRow({ tone, label }: { tone: 'ok' | 'warn' | 'neutral'; label: string }) {
  const toneClasses =
    tone === 'ok'      ? { dot: 'bg-emerald-400 ring-emerald-400/20', label: 'text-foreground/90' }
    : tone === 'warn'  ? { dot: 'bg-amber-400 ring-amber-400/20',     label: 'text-amber-300' }
    :                    { dot: 'bg-primary ring-primary/20',         label: 'text-foreground/90' };
  return (
    <li className="flex items-center gap-2 px-2.5 py-1.5 rounded-interactive">
      <span className={`h-2 w-2 flex-shrink-0 rounded-full ring-2 ${toneClasses.dot}`} />
      <span className={`typo-body font-medium truncate ${toneClasses.label}`} title={label}>
        {label}
      </span>
    </li>
  );
}

/* ================================================================== */
/* Stage base — formula + launch                                       */
/* ================================================================== */

function MatchFormula({ contenders, scenarios, duels }: { contenders: number; scenarios: number; duels: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FormulaToken n={contenders} label={`contender${contenders === 1 ? '' : 's'}`} icon={Swords} />
      <Times />
      <FormulaToken n={scenarios} label={`scenario${scenarios === 1 ? '' : 's'}`} icon={Scroll} />
      <Equals />
      <FormulaToken n={duels} label={`duel${duels === 1 ? '' : 's'}`} icon={Flame} tone="primary" />
    </div>
  );
}

function FormulaToken({
  n, label, icon: Icon, tone = 'muted',
}: { n: number; label: string; icon: LucideIcon; tone?: 'muted' | 'primary' }) {
  const color = tone === 'primary' ? 'text-foreground border-primary/35 bg-primary/15' : 'text-foreground/85 border-primary/15 bg-background/40';
  return (
    <span className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-card border ${color}`}>
      <Icon className="w-3.5 h-3.5 text-primary/70" />
      <span className="typo-body-lg font-semibold tabular-nums">{n}</span>
      <span className="typo-body text-foreground/90">{label}</span>
    </span>
  );
}
function Times()  { return <span aria-hidden className="typo-body-lg text-foreground">×</span>; }
function Equals() { return <span aria-hidden className="typo-body-lg text-foreground">=</span>; }

function WaxSealButton({
  canLaunch, contenders, disabledReason, onLaunch,
}: {
  canLaunch: boolean;
  contenders: number;
  disabledReason: string;
  onLaunch: () => void;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onLaunch}
        disabled={!canLaunch}
        data-testid="arena-run-btn"
        className={`relative group flex items-center gap-3 pl-6 pr-5 py-3 rounded-modal border typo-body-lg font-semibold transition-all ${
          canLaunch
            ? 'bg-gradient-to-r from-primary/30 via-primary/20 to-accent/20 hover:from-primary/40 hover:via-primary/30 hover:to-accent/30 border-primary/40 text-foreground shadow-elevation-3'
            : 'bg-secondary/40 border-primary/10 text-foreground/85 cursor-not-allowed'
        }`}
      >
        <span
          aria-hidden
          className={`flex items-center justify-center h-9 w-9 rounded-full -ml-3 border-2 ${
            canLaunch
              ? 'bg-gradient-to-br from-primary/80 to-accent/70 border-primary/40 shadow-[0_0_12px_rgba(var(--color-primary-rgb,180,140,255),0.5)]'
              : 'bg-secondary border-primary/20'
          }`}
        >
          <Swords className={`w-4 h-4 ${canLaunch ? 'text-background' : 'text-foreground'}`} strokeWidth={2} />
        </span>
        <span className="flex flex-col items-start leading-tight">
          <span className="typo-body-lg font-semibold">Begin the Match</span>
          <span className="typo-label text-foreground/90">
            {contenders} {contenders === 1 ? 'contender' : 'contenders'}
          </span>
        </span>
      </button>
      {!canLaunch && disabledReason && (
        <span className="typo-body text-foreground/90 flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          {disabledReason}
        </span>
      )}
    </div>
  );
}

/* ================================================================== */
/* Blueprint subcomponents                                             */
/* ================================================================== */

function SectionHeader({
  icon: Icon, eyebrow, title, subtitle,
}: { icon: LucideIcon; eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="flex items-end justify-between gap-3 px-1">
      <div>
        <p className="typo-label text-primary/80">{eyebrow}</p>
        <h4 className="typo-heading-lg font-semibold text-foreground flex items-center gap-2 mt-0.5">
          <Icon className="w-4 h-4 text-primary" />
          {title}
        </h4>
      </div>
      <span className="typo-body italic text-foreground/90">{subtitle}</span>
    </div>
  );
}

function ParchmentCard({
  title, meta, icon: Icon, children,
}: {
  title: string;
  meta: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="relative rounded-modal border border-primary/20 bg-gradient-to-b from-secondary/50 to-background/40 backdrop-blur-sm overflow-hidden">
      <span aria-hidden className="absolute top-1.5 left-1.5 h-3 w-3 border-l-2 border-t-2 border-primary/30 rounded-tl-sm" />
      <span aria-hidden className="absolute top-1.5 right-1.5 h-3 w-3 border-r-2 border-t-2 border-primary/30 rounded-tr-sm" />
      <span aria-hidden className="absolute bottom-1.5 left-1.5 h-3 w-3 border-l-2 border-b-2 border-primary/30 rounded-bl-sm" />
      <span aria-hidden className="absolute bottom-1.5 right-1.5 h-3 w-3 border-r-2 border-b-2 border-primary/30 rounded-br-sm" />
      <div className="px-4 py-3 border-b border-primary/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" strokeWidth={1.75} />
          <span className="typo-label text-primary/80">{title}</span>
        </div>
        <span className="typo-body text-foreground/90 font-medium truncate max-w-[140px]" title={meta}>{meta}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <span className="typo-body-lg italic text-foreground/90">{children}</span>
  );
}

function StatPips({ label, level, icon: Icon }: { label: string; level: number; icon: LucideIcon }) {
  return (
    <span className="flex items-center gap-0.5" title={`${label}: ${level}/3`}>
      {[1, 2, 3].map((i) => (
        <Icon key={i} className={`w-3 h-3 ${i <= level ? 'text-primary' : 'text-foreground/20'}`} strokeWidth={2} fill={i <= level ? 'currentColor' : 'none'} />
      ))}
    </span>
  );
}

function ChampionCard({
  modelLabel, heraldry, sourceLabel, personaName, iconToken, color,
}: {
  modelLabel: string;
  heraldry: ModelHeraldry;
  sourceLabel: string;
  personaName: string | null;
  iconToken: string | null;
  color: string | null;
}) {
  const Sigil = heraldry.sigil;
  return (
    <ParchmentCard title="Champion" meta={heraldry.houseName} icon={Shield}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-full border-2 border-primary/40 bg-gradient-to-br from-primary/25 to-accent/15 shadow-elevation-2">
            <Sigil className="w-6 h-6 text-foreground" strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="typo-heading text-foreground truncate">{modelLabel}</p>
            <p className="typo-body text-foreground/90 mt-0.5">{sourceLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 pt-2 border-t border-primary/10">
          <PersonaIcon icon={iconToken} color={color} size="w-5 h-5" />
          <div className="flex-1 min-w-0">
            <p className="typo-label text-primary/70">Defender</p>
            <p className="typo-body-lg font-medium text-foreground truncate">{personaName ?? '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 typo-body text-foreground/90">
          <Crown className="w-3.5 h-3.5 text-primary" />
          <span>Contenders must unseat this sword to win the chronicle.</span>
        </div>
      </div>
    </ParchmentCard>
  );
}

/* ================================================================== */
/* Chronicle                                                           */
/* ================================================================== */

function StandingChampionBanner({
  champion, totalRuns,
}: { champion: { model: string; wins: number; total: number } | null; totalRuns: number }) {
  if (!champion) {
    return (
      <div className="rounded-modal border border-primary/15 bg-secondary/30 px-4 py-3 flex items-center gap-3">
        <Trophy className="w-4 h-4 text-foreground" />
        <p className="typo-body-lg italic text-foreground/90">
          No chronicle yet — the first match will crown a champion.
        </p>
      </div>
    );
  }
  const heraldry = HERALDRY[champion.model] ?? heraldryFor(champion.model, 'unknown');
  const Sigil = heraldry.sigil;
  return (
    <div className="relative rounded-modal border border-primary/30 bg-gradient-to-r from-primary/15 via-background/40 to-accent/10 backdrop-blur-sm overflow-hidden">
      <span aria-hidden className="absolute -left-4 top-1/2 -translate-y-1/2 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
      <div className="relative flex items-center gap-4 px-4 py-3">
        <div className="flex items-center justify-center w-12 h-12 rounded-full border-2 border-primary/40 bg-gradient-to-br from-primary/30 to-accent/20 shadow-elevation-2">
          <Sigil className="w-5 h-5 text-foreground" strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="typo-label text-primary/80 flex items-center gap-1.5">
            <Crown className="w-3.5 h-3.5" fill="currentColor" />
            Standing Champion
          </p>
          <p className="typo-heading-lg font-semibold text-foreground capitalize mt-0.5 truncate">
            {champion.model}
          </p>
          <p className="typo-body text-foreground/90">
            {champion.wins} victory{champion.wins === 1 ? '' : 'ies'} of {champion.total} judged match{champion.total === 1 ? '' : 'es'} · {totalRuns} run{totalRuns === 1 ? '' : 's'} logged
          </p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/60 border border-primary/25 typo-body-lg text-foreground">
          <Trophy className="w-4 h-4 text-primary" />
          <span className="font-semibold tabular-nums">{champion.wins}</span>
          <span className="text-foreground/90">/</span>
          <span className="text-foreground/90 tabular-nums">{champion.total}</span>
        </div>
      </div>
    </div>
  );
}
