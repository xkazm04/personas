/**
 * ArenaPanelConstellation — directional alternative to ArenaPanelColosseum.
 *
 * Where the Colosseum frames the arena as a heraldic amphitheater, the
 * Constellation frames it as a celestial orrery: the persona is a solar
 * disk at the centre, and each model contender is a planet placed on a
 * concentric orbit ring whose radius encodes its *cost* tier (1 = inner,
 * 2 = middle, 3 = outer). Selecting a contender locks it into the
 * alignment and lights an arc on its ring. The metaphor carries through:
 * the use case becomes the chosen star-chart; conditions become
 * "alignment readings"; the launch button "aligns the stars".
 *
 * Extractable pieces (hoist if this wins):
 *   - Orrery + OrbitRing + OrbitalModel + SolarPersona
 *   - ChartColumn + AlignmentRow
 *   - AlignmentFormula + AlignButton
 */

import { useEffect, useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Star, Stars, Telescope, Orbit, Crown, Compass, Gauge, Coins, Zap,
  AlertTriangle, Shield, Trophy, ScrollText, BookOpen, Sparkles, HardDrive, Cloud, Sword,
} from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useSelectedUseCases } from '@/stores/selectors/personaSelectors';
import { ALL_MODELS, selectedModelsToConfigs, ANTHROPIC_MODELS, OLLAMA_LOCAL_MODELS } from '@/lib/models/modelCatalog';
import type { ModelOption } from '@/lib/models/modelCatalog';
import { usePanelRunState } from '../../libs/usePanelRunState';
import { useTranslation } from '@/i18n/useTranslation';
import { ArenaHistory } from './ArenaHistory';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { LabArenaRun } from '@/lib/bindings/LabArenaRun';

/* ------------------------------------------------------------------ */
/* Celestial metadata — sigil, cost/speed tier, epithet (parallels    */
/* Colosseum's heraldry but with cosmic vocabulary).                  */
/* ------------------------------------------------------------------ */

type CelestialBody = {
  sigil: LucideIcon;
  cost: 1 | 2 | 3;
  speed: 1 | 2 | 3;
  epithet: string;
};

const CELESTIAL: Record<string, CelestialBody> = {
  haiku:  { sigil: Zap,        cost: 1, speed: 3, epithet: 'the Meteor'   },
  sonnet: { sigil: ScrollText, cost: 2, speed: 2, epithet: 'the Satellite' },
  opus:   { sigil: BookOpen,   cost: 3, speed: 1, epithet: 'the Gas Giant' },
};

function celestialFor(id: string, provider: string): CelestialBody {
  const known = CELESTIAL[id];
  if (known) return known;
  if (provider === 'ollama') {
    const isLocal = id.startsWith('ollama:');
    return {
      sigil: isLocal ? HardDrive : Cloud,
      cost: 1,
      speed: 2,
      epithet: isLocal ? 'the Moon'  : 'the Nebula',
    };
  }
  return { sigil: Sword, cost: 2, speed: 2, epithet: 'the Wanderer' };
}

const STAR_ROSTER: ModelOption[] = [...ANTHROPIC_MODELS, ...OLLAMA_LOCAL_MODELS];

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
    } catch { /* ignore */ }
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

export function ArenaPanelConstellation() {
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

  const champion = useMemo(() => computeAllTimeChampion(arenaRuns), [arenaRuns]);

  // Group models by cost tier so they share orbits
  const byTier = useMemo(() => {
    const tiers: Record<1 | 2 | 3, Array<{ model: ModelOption; body: CelestialBody }>> = { 1: [], 2: [], 3: [] };
    for (const m of STAR_ROSTER) {
      const body = celestialFor(m.id, m.provider);
      tiers[body.cost].push({ model: m, body });
    }
    return tiers;
  }, []);

  return (
    <div className="space-y-6">
      {/* ── Masthead ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-full border border-primary/30 bg-gradient-to-br from-primary/15 to-background/30">
            <Telescope className="w-4 h-4 text-primary" strokeWidth={1.75} />
          </div>
          <div>
            <p className="typo-label text-primary/75 uppercase tracking-widest">The Constellation</p>
            <h3 className="typo-heading-lg font-semibold text-foreground">
              {selectedPersona?.name
                ? <>Aligning the stars for <span className="text-primary/85">{selectedPersona.name}</span></>
                : 'Select a persona to open the sky'}
            </h3>
          </div>
        </div>
        <div className="typo-body text-foreground/65 italic flex items-center gap-1.5">
          <Stars className="w-3.5 h-3.5 text-primary/60" />
          Chart: <span className="not-italic text-foreground/85">{selectedUseCase?.title ?? t.agents.lab.all_use_cases}</span>
        </div>
      </div>

      {/* ── Main: orrery + side reading panel ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-4">
        {/* Orrery */}
        <div className="relative overflow-hidden rounded-modal border border-primary/25 bg-gradient-to-b from-[#0a0a1a]/70 via-[#0a0a1a]/40 to-background/60 backdrop-blur-sm">
          <OrrerySky />
          <div className="relative h-[520px] mx-auto max-w-[640px]">
            {/* Orbit rings + model planets */}
            {([1, 2, 3] as const).map((tier) => {
              const rx = tier === 1 ? 132 : tier === 2 ? 200 : 262;
              const ry = tier === 1 ? 54  : tier === 2 ? 80  : 104;
              const bodies = byTier[tier];
              const anySelected = bodies.some(({ model }) => selectedModels.has(model.id));
              return (
                <OrbitRing key={tier} rx={rx} ry={ry} tier={tier} accented={anySelected} />
              );
            })}

            {([1, 2, 3] as const).flatMap((tier) => {
              const rx = tier === 1 ? 132 : tier === 2 ? 200 : 262;
              const ry = tier === 1 ? 54  : tier === 2 ? 80  : 104;
              const bodies = byTier[tier];
              const total = bodies.length;
              if (total === 0) return [];
              return bodies.map(({ model, body }, i) => {
                // Distribute evenly across the upper ellipse so planets don't hide behind the sun
                const deg = total === 1
                  ? -90
                  : -160 + (i * 140) / (total - 1);
                const rad = (deg * Math.PI) / 180;
                const x = Math.cos(rad) * rx;
                const y = Math.sin(rad) * ry;
                const isSelected = selectedModels.has(model.id);
                return (
                  <OrbitalModel
                    key={model.id}
                    label={model.label}
                    body={body}
                    selected={isSelected}
                    onToggle={() => toggleModel(model.id)}
                    style={{ left: `calc(50% + ${x}px)`, top: `calc(48% + ${y}px)` }}
                  />
                );
              });
            })}

            {/* Solar persona at centre */}
            <div className="absolute left-1/2 top-[48%] -translate-x-1/2 -translate-y-1/2 z-10">
              <SolarPersona
                name={selectedPersona?.name ?? null}
                trustScore={selectedPersona?.trust_score ?? 0}
                hasPrompt={hasPrompt}
                toolCount={toolCount}
                iconToken={selectedPersona?.icon ?? null}
                color={selectedPersona?.color ?? null}
              />
            </div>
          </div>

          {/* Alignment footer */}
          <div className="relative border-t border-primary/20 bg-background/50 px-4 sm:px-6 py-4 flex flex-wrap items-center gap-4">
            <AlignmentFormula contenders={contenderCount} scenarios={scenarioCount} duels={duelCount} />
            <div className="ml-auto flex items-center gap-3">
              {isLabRunning ? (
                <button
                  onClick={() => void handleCancel()}
                  data-testid="arena-cancel-btn"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-modal bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 typo-body-lg font-medium transition-colors"
                >
                  <Orbit className="w-4 h-4" />
                  {t.agents.lab.cancel_test}
                </button>
              ) : (
                <AlignButton
                  canLaunch={canLaunch}
                  contenders={contenderCount}
                  disabledReason={disabledReason}
                  onLaunch={() => void handleStart()}
                />
              )}
            </div>
          </div>
        </div>

        {/* Side reading panel */}
        <aside className="space-y-3">
          <ChartColumn
            useCases={useCases}
            selectedId={selectedUseCaseId}
            onSelect={setSelectedUseCaseId}
            allLabel={t.agents.lab.all_use_cases}
          />
          <AlignmentReadings
            hasPrompt={hasPrompt}
            hasTools={hasTools}
            toolCount={toolCount}
            trustScore={selectedPersona?.trust_score ?? 0}
            trustLevel={selectedPersona?.trust_level ?? 'unverified'}
            scenarioCount={scenarioCount}
          />
        </aside>
      </div>

      {/* Advisories */}
      {(!hasPrompt || !hasTools) && (
        <div className="rounded-modal border border-amber-500/25 bg-amber-500/[0.05] px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="space-y-1 text-foreground/90">
            <p className="typo-body-lg font-medium text-amber-300">The stars are not aligned</p>
            {!hasPrompt && <p className="typo-body-lg">{t.agents.lab.no_prompt_warning}</p>}
            {!hasTools && <p className="typo-body-lg">{t.agents.lab.no_tools_warning}</p>}
          </div>
        </div>
      )}

      {/* Chronicle */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3 px-1">
          <div>
            <p className="typo-label text-primary/80 uppercase tracking-widest">Astronomer's Log</p>
            <h4 className="typo-heading-lg font-semibold text-foreground flex items-center gap-2 mt-0.5">
              <ScrollText className="w-4 h-4 text-primary" />
              Past alignments
            </h4>
          </div>
          <span className="typo-body italic text-foreground/60">what the sky remembers</span>
        </div>
        <StandingChampionBanner champion={champion} totalRuns={arenaRuns.length} />
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
/* Orrery SVG sky + rings                                              */
/* ================================================================== */

function OrrerySky() {
  // Deterministic pseudo-random star field so it doesn't jitter between re-renders
  const stars = useMemo(() => {
    const arr: Array<{ x: number; y: number; r: number; o: number }> = [];
    let seed = 42;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 120; i++) {
      arr.push({
        x: rand() * 800,
        y: rand() * 520,
        r: 0.4 + rand() * 1.1,
        o: 0.25 + rand() * 0.55,
      });
    }
    return arr;
  }, []);

  return (
    <svg
      viewBox="0 0 800 520"
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-none absolute inset-0 h-full w-full text-primary"
      aria-hidden
    >
      <defs>
        <radialGradient id="sky-vignette" cx="50%" cy="50%" r="60%">
          <stop offset="40%" stopColor="transparent" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.55)" />
        </radialGradient>
        <radialGradient id="sun-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="rgba(var(--color-primary-rgb,180,140,255),0.32)" />
          <stop offset="50%"  stopColor="rgba(var(--color-primary-rgb,180,140,255),0.10)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>

      {/* Star field */}
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="white" opacity={s.o} />
      ))}

      {/* Central sun glow halo (persona anchor) */}
      <circle cx="400" cy="250" r="180" fill="url(#sun-glow)" />

      {/* Vignette */}
      <rect x="0" y="0" width="800" height="520" fill="url(#sky-vignette)" />
    </svg>
  );
}

function OrbitRing({ rx, ry, tier, accented }: { rx: number; ry: number; tier: 1 | 2 | 3; accented: boolean }) {
  return (
    <svg
      viewBox="0 0 800 520"
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      {/* Ring itself */}
      <ellipse
        cx="400" cy="250"
        rx={rx} ry={ry}
        fill="none"
        stroke="currentColor"
        className={accented ? 'text-primary/55' : 'text-primary/20'}
        strokeWidth={accented ? 1.1 : 0.8}
        strokeDasharray={accented ? '0' : '2 4'}
      />
      {/* Luminous arc when the tier has any selected body */}
      {accented && (
        <ellipse
          cx="400" cy="250"
          rx={rx} ry={ry}
          fill="none"
          stroke="currentColor"
          className="text-primary/70"
          strokeWidth={2}
          strokeDasharray={`${Math.round(rx * 0.7)} ${Math.round(rx * 4)}`}
          strokeLinecap="round"
          opacity={0.55}
        />
      )}
      {/* Tier badge on the far right edge of the ring */}
      <g transform={`translate(${400 + rx + 6}, 250)`}>
        <circle r="9" className={accented ? 'fill-primary/15 stroke-primary/50' : 'fill-background/40 stroke-primary/20'} strokeWidth="1" />
        <text x="0" y="0"
          textAnchor="middle"
          dominantBaseline="central"
          className={`typo-caption ${accented ? 'fill-primary' : 'fill-primary/50'}`}
          style={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)', fontWeight: 600 }}
        >
          T{tier}
        </text>
      </g>
    </svg>
  );
}

/* ================================================================== */
/* Orbital model chip (data-concrete — sigil + label + speed pip)     */
/* ================================================================== */

function OrbitalModel({
  label, body, selected, onToggle, style,
}: {
  label: string;
  body: CelestialBody;
  selected: boolean;
  onToggle: () => void;
  style: React.CSSProperties;
}) {
  const Sigil = body.sigil;
  return (
    <button
      type="button"
      onClick={onToggle}
      style={style}
      aria-pressed={selected}
      className="absolute -translate-x-1/2 -translate-y-1/2 group flex flex-col items-center w-[110px] focus:outline-none"
    >
      {/* Planet body */}
      <div className="relative flex items-center justify-center">
        {selected && (
          <span
            aria-hidden
            className="absolute inset-0 m-auto w-14 h-14 rounded-full bg-primary/25 blur-[6px]"
          />
        )}
        <div
          className={`relative w-11 h-11 rounded-full border flex items-center justify-center transition-all ${
            selected
              ? 'border-primary/70 bg-gradient-to-br from-primary/45 via-primary/25 to-primary/5 shadow-[inset_-6px_-6px_10px_rgba(0,0,0,0.35),0_0_14px_rgba(var(--color-primary-rgb,180,140,255),0.5)]'
              : 'border-primary/25 bg-gradient-to-br from-secondary/70 via-secondary/40 to-secondary/10 shadow-[inset_-4px_-4px_8px_rgba(0,0,0,0.35)] group-hover:border-primary/50 group-hover:from-primary/20'
          }`}
        >
          <Sigil className={`w-5 h-5 ${selected ? 'text-foreground' : 'text-foreground/60'}`} strokeWidth={1.75} />
        </div>
      </div>

      {/* Label plaque */}
      <div className={`mt-1.5 flex flex-col items-center px-2 py-1 rounded-input border typo-caption transition-colors ${
        selected
          ? 'bg-background/75 border-primary/45 text-foreground'
          : 'bg-background/45 border-primary/15 text-foreground/75 group-hover:border-primary/30 group-hover:text-foreground/90'
      }`}>
        <span className="font-semibold leading-tight truncate max-w-full">{label}</span>
        <span className={`italic leading-tight text-[10px] ${selected ? 'text-primary/85' : 'text-foreground/55'}`}>{body.epithet}</span>
        <div className="flex items-center gap-1 mt-0.5">
          <Coins className={`w-2.5 h-2.5 ${selected ? 'text-primary' : 'text-foreground/45'}`} />
          <TierDots value={body.cost} active={selected} />
          <span className={`mx-1 h-2 w-px ${selected ? 'bg-primary/40' : 'bg-primary/15'}`} />
          <Zap className={`w-2.5 h-2.5 ${selected ? 'text-primary' : 'text-foreground/45'}`} />
          <TierDots value={body.speed} active={selected} />
        </div>
      </div>
    </button>
  );
}

function TierDots({ value, active }: { value: number; active: boolean }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`w-[4px] h-[4px] rounded-full ${
            i <= value
              ? active ? 'bg-primary' : 'bg-foreground/55'
              : active ? 'bg-primary/20' : 'bg-foreground/15'
          }`}
        />
      ))}
    </span>
  );
}

/* ================================================================== */
/* Solar persona (centre anchor)                                       */
/* ================================================================== */

function SolarPersona({
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
    <div className="flex flex-col items-center">
      {/* Corona */}
      <div className="relative">
        <span
          aria-hidden
          className={`absolute inset-0 -m-3 rounded-full ${arrayed ? 'bg-primary/25' : 'bg-primary/10'} blur-[10px]`}
        />
        <div
          className={`relative w-[92px] h-[92px] rounded-full border-2 flex items-center justify-center ${
            arrayed
              ? 'border-primary/60 bg-gradient-to-br from-primary/45 via-primary/20 to-background/50 shadow-[inset_-10px_-10px_22px_rgba(0,0,0,0.5),0_0_28px_rgba(var(--color-primary-rgb,180,140,255),0.4)]'
              : 'border-primary/25 bg-gradient-to-br from-secondary/70 to-secondary/20 shadow-[inset_-6px_-6px_16px_rgba(0,0,0,0.45)]'
          }`}
        >
          <div className={`w-[72px] h-[72px] rounded-full flex items-center justify-center bg-background/40 border ${arrayed ? 'border-primary/50' : 'border-primary/20'}`}>
            <PersonaIcon icon={iconToken} color={color} size="w-9 h-9" />
          </div>
          {/* crown spark */}
          <Crown
            className={`absolute -top-3 left-1/2 -translate-x-1/2 w-5 h-5 ${arrayed ? 'text-primary' : 'text-foreground/40'}`}
            fill="currentColor"
            strokeWidth={1.25}
          />
        </div>
      </div>

      <p className="typo-body-lg font-semibold text-foreground mt-2 text-center truncate max-w-[180px]">
        {name ?? '—'}
      </p>

      {/* Trust orbit pill */}
      <div className="mt-1 flex items-center gap-1 rounded-full border border-primary/30 bg-background/65 px-2.5 py-0.5 typo-body text-foreground">
        <Shield className="w-3.5 h-3.5 text-primary" />
        <span className="font-semibold tabular-nums">{trustScore}</span>
        <span className="text-foreground/60">trust</span>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Side rail — chart + readings                                        */
/* ================================================================== */

type UseCaseLite = { id: string; title: string };

function ChartColumn({
  useCases, selectedId, onSelect, allLabel,
}: {
  useCases: UseCaseLite[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  allLabel: string;
}) {
  const effective = selectedId ?? '__all__';
  return (
    <div className="rounded-modal border border-primary/20 bg-background/50 backdrop-blur-sm overflow-hidden">
      <div className="px-3 py-2 border-b border-primary/15 flex items-center gap-2">
        <Compass className="w-3.5 h-3.5 text-primary" />
        <span className="typo-label text-primary/80 uppercase tracking-widest">Star chart</span>
      </div>
      <div className="p-2 space-y-1 max-h-[260px] overflow-y-auto">
        <ChartRow active={effective === '__all__'} onClick={() => onSelect(null)}>{allLabel}</ChartRow>
        {useCases.length === 0 ? (
          <p className="typo-body italic text-foreground/60 px-2 py-1">no chart drawn</p>
        ) : (
          useCases.map((uc) => (
            <ChartRow key={uc.id} active={uc.id === effective} onClick={() => onSelect(uc.id)}>
              {uc.title}
            </ChartRow>
          ))
        )}
      </div>
    </div>
  );
}

function ChartRow({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  const title = typeof children === 'string' ? children : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-interactive border typo-body transition-colors truncate ${
        active
          ? 'bg-primary/15 border-primary/35 text-foreground font-medium'
          : 'bg-transparent border-transparent text-foreground/75 hover:bg-background/50 hover:text-foreground'
      }`}
    >
      <Star className={`w-3 h-3 flex-shrink-0 ${active ? 'text-primary fill-current' : 'text-foreground/30'}`} />
      <span className="truncate">{children}</span>
    </button>
  );
}

function AlignmentReadings({
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
    <div className="rounded-modal border border-primary/20 bg-background/50 backdrop-blur-sm overflow-hidden">
      <div className="px-3 py-2 border-b border-primary/15 flex items-center gap-2">
        <Gauge className="w-3.5 h-3.5 text-primary" />
        <span className="typo-label text-primary/80 uppercase tracking-widest">Readings</span>
      </div>
      <ul className="p-2 space-y-1">
        <ReadingRow tone={hasPrompt ? 'ok' : 'warn'} label={hasPrompt ? 'Star-map charted' : 'No star-map'} />
        <ReadingRow
          tone={hasTools ? 'ok' : 'warn'}
          label={hasTools ? `${toolCount} instrument${toolCount === 1 ? '' : 's'} calibrated` : 'Instruments dark'}
        />
        <ReadingRow tone="neutral" label={`Trust ${trustScore} · ${trustLevel}`} />
        <ReadingRow
          tone={scenarioCount > 0 ? 'ok' : 'warn'}
          label={scenarioCount > 0 ? `${scenarioCount} chart${scenarioCount === 1 ? '' : 's'} in view` : 'No charts in view'}
        />
      </ul>
    </div>
  );
}

function ReadingRow({ tone, label }: { tone: 'ok' | 'warn' | 'neutral'; label: string }) {
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
/* Alignment formula + launch                                          */
/* ================================================================== */

function AlignmentFormula({ contenders, scenarios, duels }: { contenders: number; scenarios: number; duels: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FormulaChip n={contenders} label={`bod${contenders === 1 ? 'y' : 'ies'}`} icon={Orbit} />
      <Times />
      <FormulaChip n={scenarios} label={`chart${scenarios === 1 ? '' : 's'}`} icon={Compass} />
      <Equals />
      <FormulaChip n={duels} label={`alignment${duels === 1 ? '' : 's'}`} icon={Sparkles} tone="primary" />
    </div>
  );
}

function FormulaChip({
  n, label, icon: Icon, tone = 'muted',
}: { n: number; label: string; icon: LucideIcon; tone?: 'muted' | 'primary' }) {
  const color = tone === 'primary'
    ? 'text-foreground border-primary/40 bg-primary/15'
    : 'text-foreground/85 border-primary/20 bg-background/50';
  return (
    <span className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-card border ${color}`}>
      <Icon className="w-3.5 h-3.5 text-primary/75" />
      <span className="typo-body-lg font-semibold tabular-nums">{n}</span>
      <span className="typo-body text-foreground/70">{label}</span>
    </span>
  );
}
function Times()  { return <span aria-hidden className="typo-body-lg text-foreground/40">×</span>; }
function Equals() { return <span aria-hidden className="typo-body-lg text-foreground/40">=</span>; }

function AlignButton({
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
        className={`relative group flex items-center gap-3 pl-5 pr-5 py-3 rounded-modal border typo-body-lg font-semibold transition-all ${
          canLaunch
            ? 'bg-gradient-to-r from-primary/30 via-primary/20 to-accent/20 hover:from-primary/40 hover:via-primary/30 hover:to-accent/30 border-primary/45 text-foreground shadow-elevation-3 shadow-primary/10'
            : 'bg-secondary/40 border-primary/10 text-foreground/50 cursor-not-allowed'
        }`}
      >
        <span
          aria-hidden
          className={`flex items-center justify-center h-9 w-9 rounded-full border-2 ${
            canLaunch
              ? 'bg-gradient-to-br from-primary/80 to-accent/70 border-primary/40 shadow-[0_0_14px_rgba(var(--color-primary-rgb,180,140,255),0.6)]'
              : 'bg-secondary border-primary/20'
          }`}
        >
          <Sparkles className={`w-4 h-4 ${canLaunch ? 'text-background' : 'text-foreground/40'}`} strokeWidth={2} />
        </span>
        <span className="flex flex-col items-start leading-tight">
          <span className="typo-body-lg font-semibold">Align the stars</span>
          <span className="typo-label text-foreground/70">
            {contenders} {contenders === 1 ? 'body' : 'bodies'} in view
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
/* Chronicle header                                                    */
/* ================================================================== */

function StandingChampionBanner({
  champion, totalRuns,
}: { champion: { model: string; wins: number; total: number } | null; totalRuns: number }) {
  if (!champion) {
    return (
      <div className="rounded-modal border border-primary/15 bg-secondary/30 px-4 py-3 flex items-center gap-3">
        <Trophy className="w-4 h-4 text-foreground/40" />
        <p className="typo-body-lg italic text-foreground/60">
          The sky is new — the first alignment will name a lodestar.
        </p>
      </div>
    );
  }
  const body = CELESTIAL[champion.model] ?? celestialFor(champion.model, 'unknown');
  const Sigil = body.sigil;
  return (
    <div className="relative rounded-modal border border-primary/30 bg-gradient-to-r from-primary/15 via-background/40 to-accent/10 backdrop-blur-sm overflow-hidden">
      <span aria-hidden className="absolute -left-4 top-1/2 -translate-y-1/2 h-24 w-24 rounded-full bg-primary/15 blur-2xl" />
      <div className="relative flex items-center gap-4 px-4 py-3">
        <div className="flex items-center justify-center w-12 h-12 rounded-full border-2 border-primary/40 bg-gradient-to-br from-primary/30 to-accent/20 shadow-elevation-2">
          <Sigil className="w-5 h-5 text-foreground" strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="typo-label text-primary/80 flex items-center gap-1.5 uppercase tracking-widest">
            <Crown className="w-3.5 h-3.5" fill="currentColor" />
            Lodestar
          </p>
          <p className="typo-heading-lg font-semibold text-foreground capitalize mt-0.5">
            {champion.model} <span className="italic text-foreground/70 font-normal">{body.epithet}</span>
          </p>
          <p className="typo-body text-foreground/70">
            {champion.wins} of {champion.total} alignments · {totalRuns} run{totalRuns === 1 ? '' : 's'} logged
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
