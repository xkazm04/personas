/**
 * GenomeBreedingPanel — breeding studio for crossing top-performing personas.
 *
 * Three-pane layout (candidate dock on the left, staged hero in the centre,
 * lineage log on the right) with a decorative helix-orbit SVG behind the
 * centre pane. Mirrors the rhythm of the template-adoption Questionnaire
 * surface so the two lab experiences feel like siblings.
 *
 * Invests in *identity*: you see which personas you have, what each one
 * brings (model, trust, prompt weight, turn ceiling) and what comes out
 * (ranked offspring with plain-language "inherits" callouts).
 */
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dna, Sparkles, Play, Loader2, CheckCircle2, Plus, Target, Zap,
  DollarSign, Trash2, Crown, FlaskConical, ScrollText, Gauge, Info,
  ArrowRight, Infinity as InfinityIcon,
} from 'lucide-react';
import type { FitnessObjective } from '@/lib/bindings/FitnessObjective';
import type { FitnessScore } from '@/lib/bindings/FitnessScore';
import type { GenomeBreedingResult } from '@/lib/bindings/GenomeBreedingResult';
import type { PersonaGenome } from '@/lib/bindings/PersonaGenome';
import type { Persona } from '@/lib/bindings/Persona';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { useGenomeBreeding } from './useGenomeBreeding';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compact model-tier label. Maps "claude-opus-4-7" → "Opus 4.7". */
function modelTierLabel(profile: string | null): string {
  if (!profile) return '—';
  const m = profile.match(/(opus|sonnet|haiku)[-_]?(\d[\d.-]*)?/i);
  if (!m || !m[1]) return profile.length > 14 ? profile.slice(0, 14) + '…' : profile;
  const tier = m[1];
  const ver = m[2];
  const verClean = ver ? ver.replace(/[-_]/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '') : '';
  const Tier = tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase();
  return verClean ? `${Tier} ${verClean}` : Tier;
}

function trustTone(score: number): string {
  if (score >= 80) return 'text-status-success';
  if (score >= 50) return 'text-status-warning';
  if (score > 0)   return 'text-status-error';
  return 'text-foreground/50';
}

function promptWeightPct(p: Persona): number {
  const n = (p.system_prompt?.length ?? 0) + (p.structured_prompt?.length ?? 0);
  return Math.max(4, Math.min(100, Math.round((n / 6000) * 100)));
}

function rankLabel(i: number, total: number): { label: string; tone: string; icon: typeof Crown | null } {
  if (i === 0 && total > 1) return { label: 'Champion',    tone: 'text-status-success', icon: Crown };
  if (i === 1)              return { label: 'Runner-up',   tone: 'text-primary',        icon: null };
  if (i === 2)              return { label: 'Contender',   tone: 'text-brand-amber',    icon: null };
  return                           { label: 'Experimental', tone: 'text-foreground/60', icon: null };
}

function inheritanceLine(offspring: PersonaGenome | null, parentGenomes: Map<string, PersonaGenome>, parentIds: string[]): string | null {
  if (!offspring) return null;
  const ps: PersonaGenome[] = [];
  for (const id of parentIds) {
    const g = parentGenomes.get(id);
    if (g) ps.push(g);
  }
  if (ps.length === 0) return null;
  const modelFrom = ps.find((p) => p.model.modelProfile === offspring.model.modelProfile);
  const modelFromIdx = modelFrom ? ps.indexOf(modelFrom) : -1;
  const toolsFromIdx = ps.findIndex((p) => {
    const overlap = p.tools.toolIds.filter((t) => offspring.tools.toolIds.includes(t)).length;
    return overlap >= Math.max(1, Math.floor(offspring.tools.toolIds.length * 0.6));
  });
  const bits: string[] = [];
  if (modelFrom) bits.push(`${modelFrom.sourcePersonaName} model`);
  const toolsParent = toolsFromIdx >= 0 ? ps[toolsFromIdx] : undefined;
  if (toolsParent && toolsFromIdx !== modelFromIdx) {
    bits.push(`${toolsParent.sourcePersonaName} tools`);
  }
  if (bits.length === 0) return 'novel recombination';
  return `inherits ${bits.join(' + ')}`;
}

// ---------------------------------------------------------------------------
// BreedingHeaderBand
// ---------------------------------------------------------------------------

function BreedingHeaderBand({
  personas, runs, results, bestOverall,
}: {
  personas: Persona[];
  runs: unknown[];
  results: GenomeBreedingResult[];
  bestOverall: number | null;
}) {
  return (
    <div className="flex-shrink-0 border-b border-border bg-foreground/[0.015]">
      <div className="flex items-center gap-4 px-5 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Dna className="w-[18px] h-[18px] text-primary" aria-hidden="true" />
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full border border-primary/30"
              animate={{ scale: [1, 1.3, 1], opacity: [0.7, 0, 0.7] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
            />
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <span className="typo-section-title truncate">Breeding Studio</span>
            <span className="typo-label text-foreground/60">
              Cross-breed · Evolve · Adopt
            </span>
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-5 typo-data text-foreground">
          <span><span className="text-foreground/50">personas</span>&nbsp;{personas.length}</span>
          <span><span className="text-foreground/50">runs</span>&nbsp;{runs.length}</span>
          <span><span className="text-foreground/50">offspring</span>&nbsp;{results.length}</span>
          {bestOverall != null && (
            <span className="flex items-center gap-1 text-status-success">
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              <span className="typo-data-lg">{Math.round(bestOverall * 100)}%</span>
              <span className="typo-label text-status-success/70">best</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CandidateCard — left rail
// ---------------------------------------------------------------------------

function CandidateCard({
  persona, selected, disabled, onToggle,
}: {
  persona: Persona; selected: boolean; disabled: boolean; onToggle: () => void;
}) {
  const tier = modelTierLabel(persona.model_profile);
  const trust = Math.max(0, Math.min(100, Math.round((persona.trust_score ?? 0) * 100) / 1));
  const pw = promptWeightPct(persona);
  const turns = persona.max_turns ?? null;

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled && !selected}
      aria-pressed={selected}
      className={`w-full text-left rounded-card px-3 py-2.5 transition-all border ${
        selected
          ? 'bg-primary/10 border-primary/30'
          : 'bg-transparent border-transparent hover:bg-foreground/[0.03]'
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center ${
          selected ? 'bg-primary border-primary text-primary-foreground' : 'border-foreground/20'
        }`}>
          {selected && <CheckCircle2 className="w-3 h-3" aria-hidden="true" />}
        </span>
        <span className="flex-1 typo-body font-semibold truncate">{persona.name}</span>
        <span className="typo-caption text-foreground/60">{tier}</span>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Gauge className="w-3 h-3 text-foreground/40" aria-hidden="true" />
          <span className="typo-caption text-foreground/60 w-12">trust</span>
          <div className="flex-1 h-1 rounded-full bg-foreground/[0.08] overflow-hidden">
            <div className={`h-full rounded-full ${trustTone(trust).replace('text-', 'bg-')}`} style={{ width: `${trust}%` }} />
          </div>
          <span className={`typo-data w-9 text-right ${trustTone(trust)}`}>{trust}</span>
        </div>
        <div className="flex items-center gap-2">
          <ScrollText className="w-3 h-3 text-foreground/40" aria-hidden="true" />
          <span className="typo-caption text-foreground/60 w-12">prompt</span>
          <div className="flex-1 h-1 rounded-full bg-foreground/[0.08] overflow-hidden">
            <div className="h-full rounded-full bg-brand-purple/70" style={{ width: `${pw}%` }} />
          </div>
          <span className="typo-data text-foreground/70 w-9 text-right">{pw}</span>
        </div>
        <div className="flex items-center gap-2">
          <ArrowRight className="w-3 h-3 text-foreground/40" aria-hidden="true" />
          <span className="typo-caption text-foreground/60 w-12">turns</span>
          <span className="typo-data text-foreground/70 flex-1">
            {turns ? turns : <span className="inline-flex items-center gap-1"><InfinityIcon className="w-3 h-3" aria-hidden="true" />unlimited</span>}
          </span>
          {persona.max_budget_usd != null && (
            <span className="typo-caption text-foreground/50">
              ${persona.max_budget_usd.toFixed(2)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// HelixBackground — decorative SVG behind the hero pane
// ---------------------------------------------------------------------------

function HelixBackground({
  selectedCount, isBreeding, bestOverall,
}: { selectedCount: number; isBreeding: boolean; bestOverall: number | null }) {
  // Two crossed sine curves, a central core, orbit dots per selected parent.
  // Motion gates on state (pulse when breeding, progress arc when fitness known)
  // — no ambient loops. Every animated transform uses `scale`/`x`/`y` via
  // framer-motion rather than animating raw SVG attrs (cx/cy/r), which can
  // briefly render as undefined during mount.
  const corePct = bestOverall != null ? bestOverall : 0;
  const coreR = 48;
  const coreCircumference = 2 * Math.PI * (coreR + 6);

  const helixPath1 = 'M-300,0 C-225,-90 -150,90 -75,0 S75,-90 150,0 S300,90 375,0';
  const helixPath2 = 'M-300,0 C-225,90 -150,-90 -75,0 S75,90 150,0 S300,-90 375,0';

  const orbRadius = 180;
  const orbs = Array.from({ length: Math.max(0, selectedCount) }).map((_, i, arr) => {
    const a = (i / Math.max(arr.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(a) * orbRadius, y: Math.sin(a) * orbRadius };
  });

  return (
    <svg
      viewBox="-320 -200 640 400"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 w-full h-full text-primary pointer-events-none"
      style={{ opacity: 0.22 }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="atelier-core-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.55} />
          <stop offset="55%" stopColor="currentColor" stopOpacity={0.15} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </radialGradient>
      </defs>

      {/* Helix strands */}
      <motion.path d={helixPath1} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.2}
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: 'easeOut' }} />
      <motion.path d={helixPath2} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={1.2}
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: 'easeOut', delay: 0.15 }} />

      {/* Core glow (scale transform — safe) */}
      <motion.circle cx={0} cy={0} r={coreR + 40} fill="url(#atelier-core-glow)"
        animate={{ scale: isBreeding ? [1, 1.18, 1] : [1, 1.08, 1] }}
        transition={{ duration: isBreeding ? 1.5 : 4, repeat: Infinity, ease: 'easeInOut' }} />

      {/* Fitness ring around core */}
      <circle cx={0} cy={0} r={coreR + 6} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={2.5} className="text-foreground" />
      <motion.circle cx={0} cy={0} r={coreR + 6}
        fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" transform="rotate(-90)"
        className="text-status-success"
        style={{ strokeDasharray: coreCircumference, strokeDashoffset: coreCircumference * (1 - corePct) }}
        initial={false}
        animate={{ strokeDashoffset: coreCircumference * (1 - corePct) }}
        transition={{ duration: 0.6, ease: 'easeOut' }} />

      {/* Core body — scale transform avoids animating `r` attr (undefined-on-mount) */}
      <motion.circle cx={0} cy={0} r={coreR} fill="currentColor" fillOpacity={0.9} className="text-primary"
        animate={{ scale: isBreeding ? [1, 1.06, 1] : [1, 1.03, 1] }}
        transition={{ duration: isBreeding ? 1.2 : 3, repeat: Infinity, ease: 'easeInOut' }} />
      <circle cx={0} cy={0} r={coreR - 14} fill="currentColor" fillOpacity={0.35} className="text-primary-foreground" />
      <g transform="translate(-10 -10)" className="text-primary-foreground"><Dna width={20} height={20} /></g>

      {/* Parent orbs */}
      <AnimatePresence>
        {orbs.map((o, i) => (
          <motion.g key={i}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 0.9, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.3, delay: i * 0.05 }}>
            <line x1={o.x * 0.35} y1={o.y * 0.35} x2={o.x * 0.9} y2={o.y * 0.9}
              stroke="currentColor" strokeOpacity={0.3} strokeWidth={0.8} strokeDasharray="2 4" />
            <circle cx={o.x} cy={o.y} r={8} fill="currentColor" fillOpacity={0.35} className="text-brand-purple" />
            <circle cx={o.x} cy={o.y} r={8} fill="none" stroke="currentColor" strokeOpacity={0.7} strokeWidth={1.3} className="text-brand-purple" />
          </motion.g>
        ))}
      </AnimatePresence>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// ObjectiveTernary — triangular ternary plot for speed/quality/cost
// ---------------------------------------------------------------------------

function ObjectiveTernary({
  objective, onChange,
}: { objective: FitnessObjective; onChange: (o: FitnessObjective) => void }) {
  const h = 100;
  const w = h * (Math.sqrt(3) / 2) * 2;
  const v = {
    quality: { x: w / 2, y: 0 },
    speed:   { x: w,     y: h },
    cost:    { x: 0,     y: h },
  };
  const total = objective.quality + objective.speed + objective.cost || 1;
  const bx = objective.quality * v.quality.x + objective.speed * v.speed.x + objective.cost * v.cost.x;
  const by = objective.quality * v.quality.y + objective.speed * v.speed.y + objective.cost * v.cost.y;
  const px = bx / total;
  const py = by / total;

  return (
    <div className="rounded-card border border-border bg-foreground/[0.02] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="typo-label text-foreground/60">Fitness objective</span>
        <span className="typo-caption text-foreground/50 inline-flex items-center gap-1">
          <Info className="w-3 h-3" aria-hidden="true" /> drag weights below
        </span>
      </div>
      <div className="flex items-center gap-4">
        <svg viewBox={`-10 -10 ${w + 20} ${h + 20}`} className="w-28 h-24 flex-shrink-0" aria-hidden="true">
          <polygon
            points={`${v.quality.x},${v.quality.y} ${v.speed.x},${v.speed.y} ${v.cost.x},${v.cost.y}`}
            fill="currentColor" fillOpacity={0.04} stroke="currentColor" strokeOpacity={0.18}
            strokeWidth={0.8} className="text-foreground"
          />
          <circle cx={v.quality.x} cy={v.quality.y} r={2.5} className="text-status-success" fill="currentColor" />
          <circle cx={v.speed.x}   cy={v.speed.y}   r={2.5} className="text-status-warning" fill="currentColor" />
          <circle cx={v.cost.x}    cy={v.cost.y}    r={2.5} className="text-status-info"   fill="currentColor" />
          {/* Marker: motion.g translates via transform, child circles stay at (0,0).
              Avoids animating cx/cy attrs which can render as "undefined" on mount. */}
          <motion.g
            initial={false}
            animate={{ x: px, y: py }}
            transition={{ type: 'spring', stiffness: 160, damping: 18 }}
          >
            <circle cx={0} cy={0} r={5} fill="currentColor" className="text-primary" />
            <circle cx={0} cy={0} r={9} fill="none" stroke="currentColor" strokeOpacity={0.5} strokeWidth={1} className="text-primary" />
          </motion.g>
        </svg>
        <div className="flex-1 space-y-1.5">
          {([
            ['quality', 'Quality', Target,    'text-status-success'],
            ['speed',   'Speed',   Zap,       'text-status-warning'],
            ['cost',    'Cost',    DollarSign,'text-status-info'],
          ] as const).map(([key, label, Icon, tone]) => (
            <div key={key} className="flex items-center gap-2">
              <Icon className={`w-3 h-3 ${tone}`} aria-hidden="true" />
              <span className={`typo-caption font-semibold w-14 ${tone}`}>{label}</span>
              <input
                type="range" min={0} max={100}
                value={Math.round(objective[key] * 100)}
                onChange={(e) => {
                  const next = { ...objective, [key]: Number(e.target.value) / 100 };
                  const t = next.quality + next.speed + next.cost;
                  if (t > 0) { next.quality /= t; next.speed /= t; next.cost /= t; }
                  onChange(next);
                }}
                className="flex-1 h-1 accent-primary"
                aria-label={`${label} weight`}
              />
              <span className="typo-data text-foreground/70 w-9 text-right">{Math.round(objective[key] * 100)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OffspringGalleryCard
// ---------------------------------------------------------------------------

function OffspringGalleryCard({
  result, rank, total, runAvg, parentGenomes, onAdopt, isAdopting,
}: {
  result: GenomeBreedingResult;
  rank: number; total: number; runAvg: number;
  parentGenomes: Map<string, PersonaGenome>;
  onAdopt: () => void;
  isAdopting: boolean;
}) {
  const genome = parseJsonOrDefault<PersonaGenome | null>(result.genomeJson, null);
  const fitness = parseJsonOrDefault<FitnessScore | null>(result.fitnessJson, null);
  const overall = fitness?.overall ?? result.fitnessOverall ?? 0;
  const pct = Math.round(overall * 100);
  const delta = Math.round((overall - runAvg) * 100);

  const parentIds: string[] = parseJsonOrDefault(result.parentIds, []);
  const inherits = inheritanceLine(genome, parentGenomes, parentIds);
  const { label: rankName, tone: rankTone, icon: RankIcon } = rankLabel(rank, total);
  const name = genome?.sourcePersonaName ?? `Offspring ${result.id.slice(0, 6)}`;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="relative rounded-card border border-border bg-foreground/[0.02] overflow-hidden"
    >
      <div className={`h-1 ${pct >= 75 ? 'bg-status-success' : pct >= 55 ? 'bg-primary' : 'bg-status-info/60'}`} aria-hidden="true" />

      <div className="p-3 space-y-2.5">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {RankIcon && <RankIcon className={`w-3.5 h-3.5 ${rankTone}`} aria-hidden="true" />}
              <span className={`typo-label ${rankTone}`}>{rankName}</span>
            </div>
            <div className="typo-heading-lg text-foreground leading-tight mt-0.5 truncate">{name}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="typo-data-lg text-primary leading-none">{pct}%</div>
            <div className="typo-label text-foreground/50 mt-0.5">fitness</div>
          </div>
        </div>

        {fitness && (
          <div className="grid grid-cols-3 gap-1.5">
            {([
              ['Q', fitness.quality, 'bg-status-success'],
              ['S', fitness.speed,   'bg-status-warning'],
              ['C', fitness.cost,    'bg-status-info'],
            ] as const).map(([l, val, bar]) => (
              <div key={l} className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="typo-label text-foreground/50">{l}</span>
                  <span className="typo-data text-foreground/70">{Math.round(val * 100)}</span>
                </div>
                <div className="h-1 rounded-full bg-foreground/[0.08] overflow-hidden">
                  <div className={`h-full ${bar}`} style={{ width: `${Math.round(val * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 typo-caption">
          <span className={delta > 0 ? 'text-status-success' : delta < 0 ? 'text-status-error' : 'text-foreground/50'}>
            {delta >= 0 ? `+${delta}` : delta}% vs avg
          </span>
          {genome && (
            <>
              <span className="text-foreground/30">·</span>
              <span className="text-foreground/60 truncate">
                {genome.promptSegments.length} segments · {genome.tools.toolIds.length} tools
              </span>
            </>
          )}
        </div>

        {inherits && (
          <div className="typo-caption text-foreground/65 italic border-t border-border pt-2">
            {inherits}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="typo-caption text-foreground/50">Gen {result.generation}</span>
          {result.adopted ? (
            <span className="inline-flex items-center gap-1 typo-caption text-status-success">
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> adopted
            </span>
          ) : (
            <button
              onClick={onAdopt}
              disabled={isAdopting}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 typo-caption font-semibold rounded-interactive bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-40"
            >
              {isAdopting ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Plus className="w-3 h-3" aria-hidden="true" />}
              adopt
            </button>
          )}
        </div>
      </div>
    </motion.article>
  );
}

// ---------------------------------------------------------------------------
// Main — the rendered view consumed by LabTab
// ---------------------------------------------------------------------------

export function GenomeBreedingPanel() {
  const {
    personas, selectedParents, objective, mutationRate, generations, isBreeding,
    runs, selectedRunId, results, adoptingId, parentGenomes,
    setObjective, setMutationRate, setGenerations,
    toggleParent, handleStartBreeding, handleAdopt, handleDeleteRun, loadResults,
  } = useGenomeBreeding();

  const [stage, setStage] = useState<'recipe' | 'offspring'>(results.length > 0 ? 'offspring' : 'recipe');

  // Auto-flip to offspring when new results land for a run; drop back to recipe
  // when no run is selected. Using useEffect — useMemo would cause setState
  // during render.
  useEffect(() => {
    setStage(results.length > 0 ? 'offspring' : 'recipe');
  }, [results.length, selectedRunId]);

  const sortedResults = useMemo(
    () => [...results].sort((a, b) => (b.fitnessOverall ?? 0) - (a.fitnessOverall ?? 0)),
    [results],
  );
  const runAvg = useMemo(() => {
    if (results.length === 0) return 0;
    return results.reduce((acc, r) => acc + (r.fitnessOverall ?? 0), 0) / results.length;
  }, [results]);
  const bestOverall = sortedResults[0]?.fitnessOverall ?? null;

  const canBreed = selectedParents.length >= 2 && !isBreeding;

  return (
    <div className="flex flex-col h-full min-h-[38rem] bg-background rounded-card border border-border overflow-hidden">
      <BreedingHeaderBand personas={personas} runs={runs} results={results} bestOverall={bestOverall} />

      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* LEFT — Candidates */}
        <aside className="w-[240px] flex-shrink-0 border-r border-border bg-foreground/[0.01] flex flex-col min-h-0">
          <div className="flex-shrink-0 px-4 py-3 border-b border-border flex items-center gap-2">
            <span className="typo-label text-foreground/60">Candidates</span>
            <span className="ml-auto typo-data text-foreground/60">
              {selectedParents.length}/5
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 scrollbar-thin">
            {personas.length === 0 ? (
              <p className="typo-caption text-foreground/55 italic px-2 py-4">
                No personas available — create one first.
              </p>
            ) : personas.map((p) => (
              <CandidateCard
                key={p.id}
                persona={p}
                selected={selectedParents.includes(p.id)}
                disabled={selectedParents.length >= 5}
                onToggle={() => toggleParent(p.id)}
              />
            ))}
          </div>
        </aside>

        {/* CENTER — Stage */}
        <main className="flex-1 min-w-0 relative overflow-hidden">
          <HelixBackground
            selectedCount={selectedParents.length}
            isBreeding={isBreeding}
            bestOverall={bestOverall}
          />

          <div className="absolute inset-0 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-8 py-8">

              {results.length > 0 && (
                <div className="inline-flex gap-1 p-1 rounded-card bg-foreground/[0.04] border border-border mb-6" role="tablist" aria-label="Stage">
                  {(['recipe', 'offspring'] as const).map((s) => (
                    <button
                      key={s}
                      role="tab"
                      aria-selected={stage === s}
                      onClick={() => setStage(s)}
                      className={`px-3 py-1 typo-caption font-semibold rounded-interactive transition-colors ${
                        stage === s ? 'bg-primary/20 text-primary' : 'text-foreground/60 hover:text-foreground'
                      }`}
                    >
                      {s === 'recipe' ? 'Recipe' : `Offspring · ${results.length}`}
                    </button>
                  ))}
                </div>
              )}

              <AnimatePresence mode="wait">
                {stage === 'recipe' ? (
                  <motion.div
                    key="recipe"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-5"
                  >
                    <div>
                      <div className="typo-label text-foreground/60 mb-2">The Recipe</div>
                      <h2 className="typo-hero text-foreground leading-tight">
                        {selectedParents.length < 2
                          ? 'Pick at least two candidates.'
                          : `Cross ${selectedParents.length} personas into a new generation.`}
                      </h2>
                      <p className="typo-body-lg text-foreground/70 mt-3 max-w-xl">
                        The studio blends prompt segments, tool sets and model profiles from your chosen parents, scored against
                        the weights below. Higher mutation widens the search; more generations refines it.
                      </p>
                    </div>

                    {selectedParents.length > 0 && (
                      <div className="rounded-card border border-border bg-foreground/[0.02] p-3">
                        <div className="typo-label text-foreground/60 mb-2">Crossing</div>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedParents.map((id) => {
                            const p = personas.find((x) => x.id === id);
                            if (!p) return null;
                            return (
                              <span key={id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-interactive bg-primary/10 border border-primary/20">
                                <Dna className="w-3 h-3 text-primary" aria-hidden="true" />
                                <span className="typo-caption font-semibold text-foreground">{p.name}</span>
                                <span className="typo-caption text-foreground/55">{modelTierLabel(p.model_profile)}</span>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <ObjectiveTernary objective={objective} onChange={setObjective} />

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-card border border-border bg-foreground/[0.02] p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="typo-label text-foreground/60">Mutation rate</span>
                          <span className="typo-data-lg text-foreground">{Math.round(mutationRate * 100)}%</span>
                        </div>
                        <input
                          type="range" min={0} max={50}
                          value={Math.round(mutationRate * 100)}
                          onChange={(e) => setMutationRate(Number(e.target.value) / 100)}
                          aria-label="Mutation rate"
                          className="w-full h-1 accent-primary"
                        />
                        <p className="typo-caption text-foreground/55 mt-2">
                          {mutationRate < 0.1 ? 'Conservative — offspring closely resemble parents.' :
                           mutationRate < 0.25 ? 'Balanced — modest divergence.' :
                                                 'Aggressive — wide search, less stable.'}
                        </p>
                      </div>
                      <div className="rounded-card border border-border bg-foreground/[0.02] p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="typo-label text-foreground/60">Generations</span>
                          <span className="typo-data-lg text-foreground">{generations}</span>
                        </div>
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((g) => (
                            <button
                              key={g}
                              type="button"
                              onClick={() => setGenerations(g)}
                              aria-pressed={generations === g}
                              className={`flex-1 py-1.5 typo-caption font-semibold rounded-interactive transition-colors ${
                                generations === g
                                  ? 'bg-primary/20 text-primary'
                                  : 'bg-foreground/[0.04] text-foreground/65 hover:bg-foreground/[0.08]'
                              }`}
                            >
                              {g}
                            </button>
                          ))}
                        </div>
                        <p className="typo-caption text-foreground/55 mt-2">
                          {generations === 1 ? 'One pass — fastest.' : `${generations} passes — iterative refinement.`}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handleStartBreeding}
                      disabled={!canBreed}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 typo-body font-semibold rounded-card bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-elevation-1"
                    >
                      {isBreeding ? (
                        <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Breeding {selectedParents.length} parents across {generations} generation{generations === 1 ? '' : 's'}…</>
                      ) : (
                        <><Play className="w-4 h-4" aria-hidden="true" />
                          {selectedParents.length < 2
                            ? 'Pick candidates to begin'
                            : `Breed ${selectedParents.length} parents`}
                        </>
                      )}
                    </button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="offspring"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-5"
                  >
                    <div className="flex items-baseline justify-between">
                      <div>
                        <div className="typo-label text-foreground/60 mb-1">Results</div>
                        <h2 className="typo-hero text-foreground leading-tight">
                          {results.length} offspring bred.
                        </h2>
                        <p className="typo-body-lg text-foreground/70 mt-2 max-w-xl">
                          Sorted by overall fitness. Champion inherits the strongest
                          weighted blend — adopt any to mint a new persona in your roster.
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="typo-data-lg text-status-success">{Math.round(runAvg * 100)}%</div>
                        <div className="typo-label text-foreground/50">run avg</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {sortedResults.map((r, i) => (
                        <OffspringGalleryCard
                          key={r.id}
                          result={r}
                          rank={i}
                          total={sortedResults.length}
                          runAvg={runAvg}
                          parentGenomes={parentGenomes}
                          onAdopt={() => handleAdopt(r.id)}
                          isAdopting={adoptingId === r.id}
                        />
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {selectedRunId && results.length === 0 && (
                <div className="text-center py-10">
                  <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin text-primary" aria-hidden="true" />
                  <p className="typo-body text-foreground">Breeding in progress…</p>
                  <p className="typo-caption text-foreground/55 mt-1">Results will appear when the run completes.</p>
                </div>
              )}
            </div>
          </div>
        </main>

        {/* RIGHT — Lineage Log */}
        <aside className="w-[280px] flex-shrink-0 border-l border-border bg-foreground/[0.01] flex flex-col min-h-0">
          <div className="flex-shrink-0 px-4 py-3 border-b border-border flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-primary/70" aria-hidden="true" />
            <span className="typo-label text-foreground/60">Lineage Log</span>
            <span className="ml-auto typo-data text-foreground/60">{runs.length}</span>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 scrollbar-thin">
            {runs.length === 0 ? (
              <p className="typo-caption text-foreground/55 italic px-2 py-4">
                No runs yet. Each breed attempt will land here.
              </p>
            ) : runs.map((run) => {
              const parentCount = parseJsonOrDefault<string[]>(run.parentIds, []).length;
              const active = selectedRunId === run.id;
              const statusTone = {
                completed: 'text-status-success', running: 'text-status-warning',
                generating: 'text-status-info', failed: 'text-status-error',
                cancelled: 'text-foreground/60', drafting: 'text-status-info',
              }[run.status] ?? 'text-foreground/60';
              return (
                <div key={run.id} className="relative group">
                  <button
                    type="button"
                    onClick={() => loadResults(run.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`w-full text-left rounded-card px-3 py-2.5 transition-colors border ${
                      active
                        ? 'bg-primary/10 border-primary/25'
                        : 'bg-transparent border-transparent hover:bg-foreground/[0.03]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="typo-body font-semibold">
                        {parentCount}×{run.offspringCount} <span className="text-foreground/50 font-normal">offspring</span>
                      </span>
                      <span className={`typo-label capitalize ${statusTone}`}>{run.status}</span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="typo-caption text-foreground/55">
                        {new Date(run.createdAt).toLocaleDateString()}
                      </span>
                      {run.summary && (
                        <span className="typo-caption text-foreground/50 truncate max-w-[50%]">{run.summary}</span>
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDeleteRun(run.id); }}
                    className="absolute top-2 right-2 p-1 rounded-interactive text-foreground/40 hover:text-status-error hover:bg-status-error/10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                    aria-label="Delete breeding run"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
