/**
 * Display sub-components extracted from GenomeBreedingPanel:
 *   - ParentSelector    — scrollable persona grid for picking breeding parents
 *   - ObjectiveSliders  — speed/quality/cost weight sliders
 *   - FitnessBar        — single labelled progress bar (aria-role="meter")
 *   - FitnessDisplay    — four FitnessBar rows for a FitnessScore
 *   - OffspringCard     — one bred offspring with adopt button + diff toggle
 *   - RunCard           — one breeding run entry in the history list
 *   - BreedingEmptyState — placeholder shown when no runs exist
 */
import { useState } from 'react';
import {
  Dna, Loader2, CheckCircle2,
  Trash2, Plus, Sparkles, Zap, DollarSign, Target,
  GitCompare, EyeOff, HeartPulse,
} from 'lucide-react';
import type { FitnessObjective } from '@/lib/bindings/FitnessObjective';
import type { FitnessScore } from '@/lib/bindings/FitnessScore';
import type { GenomeBreedingRun } from '@/lib/bindings/GenomeBreedingRun';
import type { GenomeBreedingResult } from '@/lib/bindings/GenomeBreedingResult';
import type { PersonaGenome } from '@/lib/bindings/PersonaGenome';
import type { Persona } from '@/lib/bindings/Persona';
import { GenomeDiffView } from './GenomeDiffView';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function parseGenome(json: string): PersonaGenome | null {
  return parseJsonOrDefault<PersonaGenome | null>(json, null);
}

// ---------------------------------------------------------------------------
// ParentSelector
// ---------------------------------------------------------------------------

export function ParentSelector({
  personas,
  selectedIds,
  onToggle,
}: {
  personas: Persona[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5" role="group" aria-label="Parent persona selection">
      <label className="text-xs font-medium text-muted-foreground">
        {t.agents.lab.select_parents}
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
        {personas.map((p) => {
          const isSelected = selectedIds.includes(p.id);
          return (
            <button
              key={p.id}
              onClick={() => onToggle(p.id)}
              aria-pressed={isSelected}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                isSelected
                  ? 'bg-violet-500/15 border border-violet-500/30 text-violet-300'
                  : 'bg-primary/5 border border-primary/10 text-muted-foreground hover:bg-primary/10'
              }`}
            >
              <Dna className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
              <span className="truncate">{p.name}</span>
              {isSelected && <CheckCircle2 className="w-3.5 h-3.5 ml-auto text-violet-400" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {personas.length === 0 && (
        <p className="text-xs text-muted-foreground/60 italic">{t.agents.lab.no_personas_available}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ObjectiveSliders
// ---------------------------------------------------------------------------

export function ObjectiveSliders({
  objective,
  onChange,
}: {
  objective: FitnessObjective;
  onChange: (obj: FitnessObjective) => void;
}) {
  const { t } = useTranslation();
  const adjust = (key: keyof FitnessObjective, value: number) => {
    const next = { ...objective, [key]: value };
    const total = next.speed + next.quality + next.cost;
    if (total > 0) {
      next.speed /= total;
      next.quality /= total;
      next.cost /= total;
    }
    onChange(next);
  };

  const sliderRow = (
    key: keyof FitnessObjective,
    label: string,
    icon: React.ReactNode,
    color: string,
  ) => (
    <div className="flex items-center gap-3">
      <label className={`flex items-center gap-1.5 text-xs font-medium w-16 ${color}`}>
        {icon}
        {label}
      </label>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(objective[key] * 100)}
        onChange={(e) => adjust(key, Number(e.target.value) / 100)}
        aria-label={`${label} weight`}
        className="flex-1 h-1.5 accent-violet-500"
      />
      <span className="text-xs text-muted-foreground w-10 text-right" aria-live="polite">
        {Math.round(objective[key] * 100)}%
      </span>
    </div>
  );

  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-muted-foreground">{t.agents.lab.fitness_objective}</legend>
      {sliderRow('quality', 'Quality', <Target className="w-3 h-3" aria-hidden="true" />, 'text-emerald-400')}
      {sliderRow('speed', 'Speed', <Zap className="w-3 h-3" aria-hidden="true" />, 'text-amber-400')}
      {sliderRow('cost', 'Cost', <DollarSign className="w-3 h-3" aria-hidden="true" />, 'text-blue-400')}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// FitnessBar + FitnessDisplay
// ---------------------------------------------------------------------------

export function FitnessBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2" role="meter" aria-label={label} aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span className="text-xs text-muted-foreground w-14">{label}</span>
      <div className="flex-1 h-1.5 bg-primary/10 rounded-full overflow-hidden">
        <div
          className={`animate-fade-in h-full rounded-full ${color}`} style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground w-10 text-right">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

export function FitnessDisplay({ score }: { score: FitnessScore }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <FitnessBar label={t.agents.lab.overall_label} value={score.overall} color="bg-violet-500" />
      <FitnessBar label={t.agents.lab.quality_label} value={score.quality} color="bg-emerald-500" />
      <FitnessBar label={t.agents.lab.speed_label} value={score.speed} color="bg-amber-500" />
      <FitnessBar label={t.agents.lab.cost_label} value={score.cost} color="bg-blue-500" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// OffspringCard
// ---------------------------------------------------------------------------

export function OffspringCard({
  result,
  onAdopt,
  isAdopting,
  parentGenomes,
}: {
  result: GenomeBreedingResult;
  onAdopt: () => void;
  isAdopting: boolean;
  parentGenomes: Map<string, PersonaGenome>;
}) {
  const { t } = useTranslation();
  const [showDiff, setShowDiff] = useState(false);
  const genome = parseGenome(result.genomeJson);
  const fitness = parseJsonOrDefault<FitnessScore | null>(result.fitnessJson, null);

  const parentIds: string[] = parseJsonOrDefault(result.parentIds, []);
  const firstParentId = parentIds[0];
  const firstParentGenome = firstParentId ? parentGenomes.get(firstParentId) : undefined;

  return (
    <div
      className="animate-fade-slide-in border border-primary/10 rounded-lg p-3 space-y-2 bg-primary/[0.02]"
      role="article"
      aria-label={`Offspring: ${genome?.sourcePersonaName ?? result.id.slice(0, 6)}, generation ${result.generation}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Dna className="w-4 h-4 text-violet-400" aria-hidden="true" />
          <span className="text-sm font-medium truncate max-w-40">
            {genome?.sourcePersonaName ?? `Offspring ${result.id.slice(0, 6)}`}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Gen {result.generation}</span>
          {firstParentGenome && genome && (
            <button
              onClick={() => setShowDiff(!showDiff)}
              className="p-0.5 rounded text-muted-foreground/50 hover:text-violet-400 transition-colors"
              aria-label={showDiff ? 'Hide genome diff' : 'Show genome diff'}
              title="Compare with parent"
            >
              {showDiff ? <EyeOff className="w-3.5 h-3.5" /> : <GitCompare className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {genome && (
        <div className="text-xs text-muted-foreground space-y-0.5">
          <p>{genome.promptSegments.length} prompt segments, {genome.tools.toolIds.length} tools</p>
          {genome.model.modelProfile && (
            <p>Model: {genome.model.modelProfile}</p>
          )}
        </div>
      )}

      {fitness && <FitnessDisplay score={fitness} />}

      {result.fitnessOverall != null && !fitness && (
        <div className="flex items-center gap-1.5 text-xs">
          <Sparkles className="w-3 h-3 text-violet-400" aria-hidden="true" />
          <span className="text-violet-300 font-medium">
            Fitness: {Math.round(result.fitnessOverall * 100)}%
          </span>
        </div>
      )}

      {showDiff && firstParentGenome && genome && (
        <div className="animate-fade-slide-in overflow-hidden pt-1 border-t border-primary/5">
          <GenomeDiffView parent={firstParentGenome} offspring={genome} />
        </div>
      )}

      <div className="flex items-center justify-end pt-1 border-t border-primary/5">
        {result.adopted ? (
          <span className="text-xs text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> {t.agents.lab.adopted}
          </span>
        ) : (
          <button
            onClick={onAdopt}
            disabled={isAdopting}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 transition-colors disabled:opacity-50"
          >
            {isAdopting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Plus className="w-3 h-3" aria-hidden="true" />
            )}
            {t.agents.lab.adopt_as_persona}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunCard
// ---------------------------------------------------------------------------

export function RunCard({
  run,
  onSelect,
  onDelete,
  isSelected,
}: {
  run: GenomeBreedingRun;
  onSelect: () => void;
  onDelete: () => void;
  isSelected: boolean;
}) {
  const parentCount = parseJsonOrDefault<string[]>(run.parentIds, []).length;

  const statusColor = {
    generating: 'text-blue-400',
    running: 'text-amber-400',
    completed: 'text-emerald-400',
    failed: 'text-red-400',
    cancelled: 'text-muted-foreground',
    drafting: 'text-blue-400',
  }[run.status] ?? 'text-muted-foreground';

  return (
    <button
      onClick={onSelect}
      aria-current={isSelected ? 'true' : undefined}
      className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
        isSelected
          ? 'bg-violet-500/10 border-violet-500/25'
          : 'bg-primary/[0.02] border-primary/10 hover:bg-primary/5'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Dna className="w-3.5 h-3.5 text-violet-400" aria-hidden="true" />
          <span className="text-sm font-medium">
            {parentCount} parents &rarr; {run.offspringCount} offspring
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs capitalize ${statusColor}`}>{run.status}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="text-muted-foreground/40 hover:text-red-400 transition-colors"
            aria-label="Delete breeding run"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {run.summary && (
        <p className="text-xs text-muted-foreground mt-1 truncate">{run.summary}</p>
      )}
      <p className="text-xs text-muted-foreground/50 mt-0.5">
        {new Date(run.createdAt).toLocaleDateString()}
      </p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// BreedingEmptyState
// ---------------------------------------------------------------------------

export function BreedingEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="text-center py-10">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-violet-500/10 mb-3">
        <HeartPulse className="w-7 h-7 text-violet-400/60" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-medium text-muted-foreground mb-1">
        {t.agents.lab.evolve_personas_title}
      </h3>
      <p className="text-xs text-muted-foreground/60 max-w-xs mx-auto leading-relaxed">
        {t.agents.lab.evolve_personas_desc}
      </p>
    </div>
  );
}
