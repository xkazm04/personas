/**
 * ArenaPanelColosseum — directional prototype variant for ArenaPanel.
 *
 * Round-3 layout:
 *
 *   ┌─[marquee with torches at top corners]───────────────────────┐
 *   │ [use case list]    [persona + arc]    [conditions list]     │
 *   │     (left)             (center)           (right)           │
 *   └─[formula bar + "Begin the Match"]───────────────────────────┘
 *
 * The three acts below the stage (Blueprint → Chronicle) remain. The
 * Champion card now reports the persona's *effective model* (use-case
 * override → persona.model_profile → default) rather than persona
 * readiness, because readiness already lives in the stage's right rail.
 *
 * Extractable pieces (consider hoisting if this wins):
 *   - ArenaMarquee, Torch, StageScenery
 *   - UseCaseList, ConditionsList
 *   - PersonaStandard, ContenderArc, ModelBanner, InlinePips
 *   - MatchFormula, WaxSealButton
 *   - SectionHeader, ParchmentCard, StatPips
 *   - ChampionBanner, ChronicleScrollHeader
 */

import { useEffect, useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle, Shield, Flame, Trophy, Swords, Sparkles, Crown, Scroll,
  ScrollText, BookOpen, Zap, Cloud, HardDrive, Medal, Circle, Coins,
  Sword, Feather,
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
/* Model heraldry — sigils + cost/speed pips + epithets               */
/* ------------------------------------------------------------------ */

type ModelHeraldry = {
  sigil: LucideIcon;
  cost: 1 | 2 | 3;
  speed: 1 | 2 | 3;
  epithet: string;
  houseIcon: LucideIcon;
  houseName: string;
};

const HERALDRY: Record<string, ModelHeraldry> = {
  haiku:  { sigil: Zap,        cost: 1, speed: 3, epithet: 'the Swift',    houseIcon: Sparkles, houseName: 'Anthropic' },
  sonnet: { sigil: ScrollText, cost: 2, speed: 2, epithet: 'the Balanced', houseIcon: Sparkles, houseName: 'Anthropic' },
  opus:   { sigil: BookOpen,   cost: 3, speed: 1, epithet: 'the Scholar',  houseIcon: Sparkles, houseName: 'Anthropic' },
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
      epithet: isLocal ? 'of the Hearth' : 'of the Cloud',
      houseIcon: isLocal ? HardDrive : Cloud,
      houseName: isLocal ? 'Ollama Local' : 'Ollama Cloud',
    };
  }
  return { sigil: Sword, cost: 2, speed: 2, epithet: 'the Unknown', houseIcon: Shield, houseName: provider };
}

/** Arena roster: all locally-available contenders. Cloud presets live in
 *  a deeper drawer to keep the arc readable. */
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

  // Champion = effective model (use case override → persona.model_profile → default sonnet)
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
      <div className="relative overflow-hidden rounded-modal border border-primary/25 bg-gradient-to-b from-secondary/70 via-background/70 to-background/50 backdrop-blur-sm">
        {/* Torches pinned to TOP CORNERS so they don't collide with side rails */}
        <Torch side="left"  lit={canLaunch} />
        <Torch side="right" lit={canLaunch} />

        <ArenaMarquee
          personaName={selectedPersona?.name}
          match={selectedUseCase?.title ?? t.agents.lab.all_use_cases}
          ready={canLaunch}
        />

        {/* 3-column stage body */}
        <div className="relative px-4 sm:px-6 pb-6 pt-3 grid grid-cols-1 lg:grid-cols-[190px_minmax(0,1fr)_200px] gap-4">
          {/* LEFT : use cases list */}
          <UseCaseList
            useCases={useCases}
            selectedId={selectedUseCaseId}
            onSelect={setSelectedUseCaseId}
            allLabel={t.agents.lab.all_use_cases}
          />

          {/* CENTER : SVG scenery + persona + contender arc */}
          <div className="relative min-h-[500px]">
            <StageScenery />
            <div className="relative mx-auto h-[500px] w-full max-w-[620px]">
              {/* Contender arc — widened, pinned to upper third of the stage */}
              {ARENA_ROSTER.map((m, i) => {
                const total = ARENA_ROSTER.length;
                // Upper arc -150° → -30°, flatter & wider for breathing room
                const deg = -150 + (i * 120) / Math.max(total - 1, 1);
                const rad = (deg * Math.PI) / 180;
                const rx = 252;
                const ry = 78;
                const x = Math.cos(rad) * rx;
                const y = Math.sin(rad) * ry;
                const isSelected = selectedModels.has(m.id);
                const heraldry = heraldryFor(m.id, m.provider);
                return (
                  <ModelBanner
                    key={m.id}
                    label={m.label}
                    selected={isSelected}
                    heraldry={heraldry}
                    onToggle={() => toggleModel(m.id)}
                    style={{
                      left: `calc(50% + ${x}px)`,
                      top: `calc(24% + ${y}px)`,
                    }}
                  />
                );
              })}

              {/* Persona standard — pinned to lower half, clear of the arc */}
              <div className="absolute left-1/2 top-[72%] -translate-x-1/2 -translate-y-1/2 z-10">
                <PersonaStandard
                  name={selectedPersona?.name ?? null}
                  trustScore={selectedPersona?.trust_score ?? 0}
                  hasPrompt={hasPrompt}
                  toolCount={toolCount}
                  iconToken={selectedPersona?.icon ?? null}
                  color={selectedPersona?.color ?? null}
                />
              </div>
            </div>
          </div>

          {/* RIGHT : match conditions list */}
          <ConditionsList
            hasPrompt={hasPrompt}
            hasTools={hasTools}
            toolCount={toolCount}
            trustScore={selectedPersona?.trust_score ?? 0}
            trustLevel={selectedPersona?.trust_level ?? 'unverified'}
            scenarioCount={scenarioCount}
            warnings={{
              prompt: !hasPrompt ? t.agents.lab.no_prompt_warning : null,
              tools: !hasTools ? t.agents.lab.no_tools_warning : null,
            }}
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
                        <span className="flex-1 min-w-0">
                          <span className="typo-body-lg font-medium text-foreground">{m.label}</span>
                          <span className="typo-body text-foreground/60 italic ml-1.5">{h.epithet}</span>
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
                    <p className="typo-body-lg text-foreground/80 mt-1">
                      Every authored use case will be fought.
                    </p>
                  </>
                ) : (
                  <EmptyLine>No use cases authored — the match will run on defaults.</EmptyLine>
                )}
              </div>
              <div className="pt-2 border-t border-primary/10 typo-body text-foreground/70">
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
      <div className="flex items-center justify-center gap-2 typo-body text-foreground/50 pt-2">
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
/* Stage header + scenery                                              */
/* ================================================================== */

function ArenaMarquee({
  personaName, match, ready,
}: { personaName: string | undefined; match: string; ready: boolean }) {
  return (
    <div className="relative px-16 pt-6 pb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-primary">
          <Swords className="w-5 h-5" />
          <Flame className={`w-4 h-4 ${ready ? 'text-amber-300' : 'text-foreground/40'}`} fill="currentColor" strokeWidth={1.25} />
        </div>
        <div>
          <h3 className="typo-heading-lg font-semibold text-foreground tracking-wide">The Arena</h3>
          <p className="typo-body-lg text-foreground/80">
            {personaName
              ? <>A trial for <span className="text-foreground font-medium">{personaName}</span> — <span className="italic text-primary/80">{match}</span></>
              : 'Select a persona to open the gates'}
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

function StageScenery() {
  // Richer amphitheater: layered stone tiers with radial sector seams, paired
  // colonnades at the rim, a defined duel circle with chalk markings, and a
  // soft volumetric haze over the sand. All currentColor / primary-token
  // so it tints with the theme.
  return (
    <svg
      viewBox="0 0 800 500"
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-none absolute inset-0 h-full w-full text-primary"
      aria-hidden
    >
      <defs>
        <radialGradient id="arena-sand" cx="50%" cy="76%" r="48%">
          <stop offset="0%"  stopColor="rgba(var(--color-primary-rgb,180,140,255),0.26)" />
          <stop offset="55%" stopColor="rgba(var(--color-primary-rgb,180,140,255),0.08)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <radialGradient id="arena-duel-ring" cx="50%" cy="50%" r="50%">
          <stop offset="70%" stopColor="transparent" />
          <stop offset="92%" stopColor="rgba(var(--color-primary-rgb,180,140,255),0.22)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <linearGradient id="arena-sky" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%"  stopColor="rgba(var(--color-primary-rgb,180,140,255),0.12)" />
          <stop offset="70%" stopColor="rgba(var(--color-primary-rgb,180,140,255),0.02)" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
        <linearGradient id="arena-pillar" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"  stopColor="rgba(var(--color-primary-rgb,180,140,255),0.32)" />
          <stop offset="100%" stopColor="rgba(var(--color-primary-rgb,180,140,255),0.02)" />
        </linearGradient>
        <filter id="arena-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.5" />
        </filter>
      </defs>

      {/* Sky wash */}
      <rect x="0" y="0" width="800" height="290" fill="url(#arena-sky)" />

      {/* Distant colonnade silhouettes — left & right flanks */}
      <g opacity="0.55" filter="url(#arena-soft)">
        {[50, 92, 134, 176, 218].map((x) => (
          <g key={`L-${x}`}>
            <rect x={x} y="80" width="14" height="170" fill="url(#arena-pillar)" />
            <rect x={x - 3} y="76" width="20" height="8" fill="currentColor" opacity="0.25" />
            <rect x={x - 2} y="246" width="18" height="6" fill="currentColor" opacity="0.25" />
          </g>
        ))}
        {[582, 624, 666, 708, 750].map((x) => (
          <g key={`R-${x}`}>
            <rect x={x} y="80" width="14" height="170" fill="url(#arena-pillar)" />
            <rect x={x - 3} y="76" width="20" height="8" fill="currentColor" opacity="0.25" />
            <rect x={x - 2} y="246" width="18" height="6" fill="currentColor" opacity="0.25" />
          </g>
        ))}
      </g>

      {/* Connecting entablature / architrave band behind the colonnades */}
      <rect x="20" y="70" width="760" height="4" fill="currentColor" opacity="0.2" />
      <rect x="20" y="258" width="760" height="3" fill="currentColor" opacity="0.15" />

      {/* Stone tier rings (bleachers), concentric ellipses with radial spokes */}
      <g stroke="currentColor" fill="none">
        <ellipse cx="400" cy="430" rx="370" ry="140" strokeOpacity="0.06" />
        <ellipse cx="400" cy="430" rx="320" ry="120" strokeOpacity="0.09" />
        <ellipse cx="400" cy="430" rx="272" ry="100" strokeOpacity="0.13" />
        <ellipse cx="400" cy="430" rx="228" ry="82"  strokeOpacity="0.18" />
        <ellipse cx="400" cy="430" rx="190" ry="68"  strokeOpacity="0.24" />
      </g>

      {/* Radial sector seams (bleacher aisles) */}
      <g stroke="currentColor" strokeOpacity="0.08" strokeWidth="1">
        {Array.from({ length: 10 }).map((_, i) => {
          const a = -Math.PI + (i * Math.PI) / 9;
          const x1 = 400 + Math.cos(a) * 190;
          const y1 = 430 + Math.sin(a) * 68;
          const x2 = 400 + Math.cos(a) * 370;
          const y2 = 430 + Math.sin(a) * 140;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
      </g>

      {/* Sand floor */}
      <ellipse cx="400" cy="430" rx="190" ry="68" fill="url(#arena-sand)" />

      {/* Duel chalk circle */}
      <ellipse cx="400" cy="430" rx="108" ry="38" fill="url(#arena-duel-ring)" />
      <ellipse
        cx="400" cy="430" rx="108" ry="38"
        fill="none" stroke="currentColor" strokeOpacity="0.34"
        strokeDasharray="3 5" strokeWidth="1"
      />

      {/* Center mark — crossed swords on sand */}
      <g stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.5" strokeLinecap="round">
        <line x1="380" y1="418" x2="420" y2="442" />
        <line x1="420" y1="418" x2="380" y2="442" />
      </g>

      {/* Soft floor haze */}
      <ellipse
        cx="400" cy="420" rx="300" ry="16"
        fill="rgba(var(--color-primary-rgb,180,140,255),0.06)"
        filter="url(#arena-soft)"
      />
    </svg>
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
/* Stage center — persona + contenders                                 */
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
        className={`w-6 h-6 ${arrayed ? 'text-primary' : 'text-foreground/40'} -mb-0.5`}
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
        {/* Soft cast shadow under plinth */}
        <div className="h-1 w-[150px] rounded-full bg-primary/12 blur-sm mt-0.5" />
      </div>

      <div className="mt-2 flex items-center gap-1 rounded-full border border-primary/30 bg-background/75 px-3 py-0.5 typo-body text-foreground">
        <Shield className="w-3.5 h-3.5 text-primary" />
        <span className="font-semibold">{trustScore}</span>
        <span className="text-foreground/60">trust</span>
      </div>
    </div>
  );
}

function ModelBanner({
  label, selected, heraldry, onToggle, style,
}: {
  label: string;
  selected: boolean;
  heraldry: ModelHeraldry;
  onToggle: () => void;
  style: React.CSSProperties;
}) {
  const Sigil = heraldry.sigil;
  return (
    <button
      type="button"
      onClick={onToggle}
      style={style}
      aria-pressed={selected}
      className="absolute -translate-x-1/2 -translate-y-1/2 group flex flex-col items-center w-[124px] focus:outline-none"
    >
      {/* Pennant atop the banner — flutters up when selected */}
      <div className="relative h-4 w-[18px]">
        <div
          aria-hidden
          className={`absolute inset-x-0 top-0 h-4 transition-colors ${
            selected ? 'bg-primary/70' : 'bg-primary/20 group-hover:bg-primary/35'
          }`}
          style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%)' }}
        />
        <div className={`absolute left-1/2 -translate-x-1/2 top-0 h-4 w-px ${selected ? 'bg-primary/70' : 'bg-primary/30'}`} />
      </div>

      <div
        className={`relative w-[116px] px-2 pt-3 pb-6 transition-all ${
          selected
            ? 'bg-gradient-to-b from-primary/40 via-primary/20 to-primary/5 border-x-2 border-primary/55 shadow-elevation-3 shadow-primary/15'
            : 'bg-gradient-to-b from-secondary/55 via-secondary/35 to-secondary/10 border-x-2 border-primary/15 opacity-85 group-hover:opacity-100 group-hover:border-primary/35 group-hover:shadow-elevation-2'
        }`}
        style={{ clipPath: 'polygon(0 0, 100% 0, 100% 85%, 50% 100%, 0 85%)' }}
      >
        {/* Sigil medallion */}
        <div className={`relative mx-auto w-12 h-12 rounded-full flex items-center justify-center border ${
          selected ? 'border-primary/60 bg-gradient-to-br from-primary/30 to-background/50 shadow-inner' : 'border-primary/20 bg-background/40'
        }`}>
          <Sigil className={`w-6 h-6 ${selected ? 'text-foreground' : 'text-foreground/55'}`} strokeWidth={1.75} />
        </div>

        <p className={`typo-body font-semibold text-center mt-1.5 truncate ${selected ? 'text-foreground' : 'text-foreground/80'}`}>
          {label}
        </p>
        <p className={`typo-caption italic text-center truncate ${selected ? 'text-primary/85' : 'text-foreground/55'}`}>
          {heraldry.epithet}
        </p>

        {/* Tiny cost / speed row — data-concrete under the name */}
        <div className="flex items-center justify-center gap-2 mt-1.5">
          <BannerPips level={heraldry.cost}  icon={Coins} active={selected} title="cost" />
          <span className={`h-2 w-px ${selected ? 'bg-primary/40' : 'bg-primary/15'}`} />
          <BannerPips level={heraldry.speed} icon={Zap}   active={selected} title="speed" />
        </div>
      </div>

      {selected && (
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_10px_rgba(var(--color-primary-rgb,180,140,255),0.9)]" />
      )}
    </button>
  );
}

function BannerPips({ level, icon: Icon, active, title }: { level: number; icon: LucideIcon; active: boolean; title: string }) {
  return (
    <span className="flex items-center gap-0.5" title={`${title}: ${level}/3`}>
      <Icon className={`w-2.5 h-2.5 ${active ? 'text-primary' : 'text-foreground/40'}`} strokeWidth={2} />
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`inline-block w-[5px] h-[5px] rounded-full ${
            i <= level
              ? active ? 'bg-primary' : 'bg-foreground/50'
              : active ? 'bg-primary/20' : 'bg-foreground/15'
          }`}
        />
      ))}
    </span>
  );
}

/* ================================================================== */
/* Stage side rails — use case list + conditions                       */
/* ================================================================== */

type UseCaseLite = { id: string; title: string };
function UseCaseList({
  useCases, selectedId, onSelect, allLabel,
}: {
  useCases: UseCaseLite[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  allLabel: string;
}) {
  const effective = selectedId ?? '__all__';
  return (
    <aside className="rounded-card border border-primary/20 bg-background/50 backdrop-blur-sm">
      <div className="px-3 py-2 border-b border-primary/15">
        <span className="typo-label text-primary/80">The Ground</span>
      </div>
      <div className="p-2 space-y-1 lg:max-h-[400px] lg:overflow-y-auto">
        <UseCaseRow active={effective === '__all__'} onClick={() => onSelect(null)}>{allLabel}</UseCaseRow>
        {useCases.length === 0 ? (
          <p className="typo-body italic text-foreground/60 px-2 py-1">no ground authored</p>
        ) : (
          useCases.map((uc) => (
            <UseCaseRow key={uc.id} active={uc.id === effective} onClick={() => onSelect(uc.id)}>
              {uc.title}
            </UseCaseRow>
          ))
        )}
      </div>
    </aside>
  );
}

function UseCaseRow({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  const title = typeof children === 'string' ? children : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`w-full text-left px-2.5 py-1.5 rounded-interactive border typo-body transition-colors truncate ${
        active
          ? 'bg-primary/15 border-primary/35 text-foreground font-medium'
          : 'bg-transparent border-transparent text-foreground/75 hover:bg-background/50 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function ConditionsList({
  hasPrompt, hasTools, toolCount, trustScore, trustLevel, scenarioCount,
}: {
  hasPrompt: boolean;
  hasTools: boolean;
  toolCount: number;
  trustScore: number;
  trustLevel: string;
  scenarioCount: number;
  warnings: { prompt: string | null; tools: string | null };
}) {
  return (
    <aside className="rounded-card border border-primary/20 bg-background/50 backdrop-blur-sm">
      <div className="px-3 py-2 border-b border-primary/15">
        <span className="typo-label text-primary/80">Conditions</span>
      </div>
      <ul className="p-2 space-y-1 lg:max-h-[400px] lg:overflow-y-auto">
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
      <span className="typo-body text-foreground/70">{label}</span>
    </span>
  );
}
function Times()  { return <span aria-hidden className="typo-body-lg text-foreground/40">×</span>; }
function Equals() { return <span aria-hidden className="typo-body-lg text-foreground/40">=</span>; }

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
            : 'bg-secondary/40 border-primary/10 text-foreground/50 cursor-not-allowed'
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
          <Swords className={`w-4 h-4 ${canLaunch ? 'text-background' : 'text-foreground/40'}`} strokeWidth={2} />
        </span>
        <span className="flex flex-col items-start leading-tight">
          <span className="typo-body-lg font-semibold">Begin the Match</span>
          <span className="typo-label text-foreground/70">
            {contenders} {contenders === 1 ? 'contender' : 'contenders'}
          </span>
        </span>
      </button>
      {!canLaunch && disabledReason && (
        <span className="typo-body text-foreground/70 flex items-center gap-1">
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
      <span className="typo-body italic text-foreground/60">{subtitle}</span>
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
        <span className="typo-body text-foreground/70 font-medium truncate max-w-[140px]" title={meta}>{meta}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <span className="typo-body-lg italic text-foreground/60">{children}</span>
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
            <p className="typo-heading text-foreground">
              {modelLabel}
              {heraldry.epithet && (
                <span className="italic text-foreground/70 font-normal ml-1.5">{heraldry.epithet}</span>
              )}
            </p>
            <p className="typo-body text-foreground/70 mt-0.5">{sourceLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 pt-2 border-t border-primary/10">
          <PersonaIcon icon={iconToken} color={color} size="w-5 h-5" />
          <div className="flex-1 min-w-0">
            <p className="typo-label text-primary/70">Defender</p>
            <p className="typo-body-lg font-medium text-foreground truncate">{personaName ?? '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 typo-body text-foreground/70">
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
        <Trophy className="w-4 h-4 text-foreground/40" />
        <p className="typo-body-lg italic text-foreground/60">
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
          <p className="typo-heading-lg font-semibold text-foreground capitalize mt-0.5">
            {champion.model} <span className="italic text-foreground/70 font-normal">{heraldry.epithet}</span>
          </p>
          <p className="typo-body text-foreground/70">
            {champion.wins} victory{champion.wins === 1 ? '' : 'ies'} of {champion.total} judged match{champion.total === 1 ? '' : 'es'} · {totalRuns} run{totalRuns === 1 ? '' : 's'} logged
          </p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/60 border border-primary/25 typo-body-lg text-foreground">
          <Trophy className="w-4 h-4 text-primary" />
          <span className="font-semibold tabular-nums">{champion.wins}</span>
          <span className="text-foreground/60">/</span>
          <span className="text-foreground/60 tabular-nums">{champion.total}</span>
        </div>
      </div>
    </div>
  );
}
