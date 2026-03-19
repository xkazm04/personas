import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dna, Play, Loader2, CheckCircle2,
  Trash2, Plus, Sparkles, Zap, DollarSign, Target,
  GitCompare, EyeOff, HeartPulse,
} from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import * as genomeApi from '@/api/agents/genome';
import type { FitnessObjective } from '@/lib/bindings/FitnessObjective';
import type { FitnessScore } from '@/lib/bindings/FitnessScore';
import type { GenomeBreedingRun } from '@/lib/bindings/GenomeBreedingRun';
import type { GenomeBreedingResult } from '@/lib/bindings/GenomeBreedingResult';
import type { PersonaGenome } from '@/lib/bindings/PersonaGenome';
import type { Persona } from '@/lib/bindings/Persona';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { GenerationEvolutionChart } from './GenerationEvolutionChart';
import { GenomeDiffView } from './GenomeDiffView';
import { silentCatch } from '@/lib/silentCatch';
import { log } from '@/lib/log';

// ============================================================================
// Parent selector
// ============================================================================

function ParentSelector({
  personas,
  selectedIds,
  onToggle,
}: {
  personas: Persona[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-1.5" role="group" aria-label="Parent persona selection">
      <label className="text-xs font-medium text-muted-foreground">
        Select Parents (2-5 personas)
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
        <p className="text-xs text-muted-foreground/60 italic">No personas available</p>
      )}
    </div>
  );
}

// ============================================================================
// Fitness objective sliders
// ============================================================================

function ObjectiveSliders({
  objective,
  onChange,
}: {
  objective: FitnessObjective;
  onChange: (obj: FitnessObjective) => void;
}) {
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
      <legend className="text-xs font-medium text-muted-foreground">Fitness Objective</legend>
      {sliderRow('quality', 'Quality', <Target className="w-3 h-3" aria-hidden="true" />, 'text-emerald-400')}
      {sliderRow('speed', 'Speed', <Zap className="w-3 h-3" aria-hidden="true" />, 'text-amber-400')}
      {sliderRow('cost', 'Cost', <DollarSign className="w-3 h-3" aria-hidden="true" />, 'text-blue-400')}
    </fieldset>
  );
}

// ============================================================================
// Fitness score display
// ============================================================================

function FitnessBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2" role="meter" aria-label={label} aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span className="text-xs text-muted-foreground w-14">{label}</span>
      <div className="flex-1 h-1.5 bg-primary/10 rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.round(value * 100)}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
      <span className="text-xs text-muted-foreground w-10 text-right">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

function FitnessDisplay({ score }: { score: FitnessScore }) {
  return (
    <div className="space-y-1.5">
      <FitnessBar label="Overall" value={score.overall} color="bg-violet-500" />
      <FitnessBar label="Quality" value={score.quality} color="bg-emerald-500" />
      <FitnessBar label="Speed" value={score.speed} color="bg-amber-500" />
      <FitnessBar label="Cost" value={score.cost} color="bg-blue-500" />
    </div>
  );
}

// ============================================================================
// Offspring card (with diff toggle)
// ============================================================================

function parseGenome(json: string): PersonaGenome | null {
  try { return JSON.parse(json); } catch { return null; }
}

function OffspringCard({
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
  const [showDiff, setShowDiff] = useState(false);
  const genome = parseGenome(result.genomeJson);

  const fitness: FitnessScore | null = (() => {
    try { return result.fitnessJson ? JSON.parse(result.fitnessJson) : null; } catch { return null; }
  })();

  // Find first parent genome for diff
  const parentIds: string[] = (() => {
    try { return JSON.parse(result.parentIds); } catch { return []; }
  })();
  const firstParentId = parentIds[0];
  const firstParentGenome = firstParentId ? parentGenomes.get(firstParentId) : undefined;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="border border-primary/10 rounded-lg p-3 space-y-2 bg-primary/[0.02]"
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

      {/* Genome diff section */}
      <AnimatePresence>
        {showDiff && firstParentGenome && genome && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden pt-1 border-t border-primary/5"
          >
            <GenomeDiffView parent={firstParentGenome} offspring={genome} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-end pt-1 border-t border-primary/5">
        {result.adopted ? (
          <span className="text-xs text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Adopted
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
            Adopt as Persona
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ============================================================================
// Run history card
// ============================================================================

function RunCard({
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
  const parentCount = (() => {
    try { return JSON.parse(run.parentIds).length; } catch { return 0; }
  })();

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

// ============================================================================
// Empty state
// ============================================================================

function BreedingEmptyState() {
  return (
    <div className="text-center py-10">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-violet-500/10 mb-3">
        <HeartPulse className="w-7 h-7 text-violet-400/60" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-medium text-muted-foreground mb-1">
        Evolve your personas
      </h3>
      <p className="text-xs text-muted-foreground/60 max-w-xs mx-auto leading-relaxed">
        Select 2-5 parent personas above, tune the fitness objective, then click
        Start Breeding. The genetic algorithm will cross-breed prompts, tools,
        and model configurations to discover novel high-performing variants.
      </p>
    </div>
  );
}

// ============================================================================
// Main panel
// ============================================================================

export function GenomeBreedingPanel() {
  const personas = useAgentStore((s) => s.personas);
  const addToast = useToastStore((s) => s.addToast);

  const [selectedParents, setSelectedParents] = useState<string[]>([]);
  const [objective, setObjective] = useState<FitnessObjective>({
    speed: 0.33, quality: 0.34, cost: 0.33,
  });
  const [mutationRate, setMutationRate] = useState(0.15);
  const [generations, setGenerations] = useState(1);
  const [isBreeding, setIsBreeding] = useState(false);

  const [runs, setRuns] = useState<GenomeBreedingRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [results, setResults] = useState<GenomeBreedingResult[]>([]);
  const [adoptingId, setAdoptingId] = useState<string | null>(null);
  const [hasLoadedRuns, setHasLoadedRuns] = useState(false);
  const [parentGenomes, setParentGenomes] = useState<Map<string, PersonaGenome>>(new Map());

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const loadRuns = useCallback(async () => {
    const data = await genomeApi.listBreedingRuns().catch((e) => {
      log.warn('genome', 'listBreedingRuns failed', { error: String(e) });
      return [] as GenomeBreedingRun[];
    });
    setRuns(data);
    setHasLoadedRuns(true);
  }, []);

  const loadResults = useCallback(async (runId: string) => {
    const data = await genomeApi.getBreedingResults(runId).catch((e) => {
      log.warn('genome', 'getBreedingResults failed', { error: String(e) });
      return [] as GenomeBreedingResult[];
    });
    setResults(data);
    setSelectedRunId(runId);

    // Extract parent genomes for diff view
    const run = runs.find((r) => r.id === runId);
    if (run) {
      const parentIds: string[] = (() => {
        try { return JSON.parse(run.parentIds); } catch { return []; }
      })();
      const genomeMap = new Map<string, PersonaGenome>();
      for (const pid of parentIds) {
        try {
          const g = await genomeApi.extractGenome(pid);
          genomeMap.set(pid, g);
        } catch {
          // Parent may have been deleted
        }
      }
      setParentGenomes(genomeMap);
    }
  }, [runs]);

  // Load runs on first render
  if (!hasLoadedRuns) { loadRuns(); }

  const toggleParent = (id: string) => {
    setSelectedParents((prev) =>
      prev.includes(id)
        ? prev.filter((p) => p !== id)
        : prev.length >= 5 ? prev : [...prev, id],
    );
  };

  const handleStartBreeding = async () => {
    if (selectedParents.length < 2) {
      addToast('Select at least 2 parent personas', 'error');
      return;
    }
    setIsBreeding(true);
    try {
      const run = await genomeApi.startBreeding(
        selectedParents,
        objective,
        mutationRate,
        generations,
      );
      addToast('Breeding run started', 'success');
      setRuns((prev) => [run, ...prev]);
      setSelectedRunId(run.id);

      // Clear any existing poll
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      // Poll for completion
      pollRef.current = setInterval(async () => {
        const updated = await genomeApi.listBreedingRuns().catch(() => [] as GenomeBreedingRun[]);
        setRuns(updated);
        const current = updated.find((r) => r.id === run.id);
        if (current && (current.status === 'completed' || current.status === 'failed')) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          if (current.status === 'completed') {
            loadResults(run.id);
            addToast(`Breeding complete: ${current.offspringCount} offspring`, 'success');
          } else {
            addToast(`Breeding failed: ${current.error ?? 'Unknown error'}`, 'error');
          }
        }
      }, 2000);

      // Safety timeout
      timeoutRef.current = setTimeout(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 120_000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast(`Breeding failed: ${msg}`, 'error');
    } finally {
      setIsBreeding(false);
    }
  };

  const handleAdopt = async (resultId: string) => {
    setAdoptingId(resultId);
    try {
      const persona = await genomeApi.adoptOffspring(resultId);
      addToast(`Created persona: ${persona.name}`, 'success');
      setResults((prev) =>
        prev.map((r) => r.id === resultId ? { ...r, adopted: true, adoptedPersonaId: persona.id } : r),
      );
      useAgentStore.getState().fetchPersonas();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast(`Adoption failed: ${msg}`, 'error');
    } finally {
      setAdoptingId(null);
    }
  };

  const handleDeleteRun = async (id: string) => {
    await genomeApi.deleteBreedingRun(id).catch(silentCatch('genome:deleteBreedingRun'));
    setRuns((prev) => prev.filter((r) => r.id !== id));
    if (selectedRunId === id) {
      setSelectedRunId(null);
      setResults([]);
      setParentGenomes(new Map());
    }
  };

  const hasRunHistory = runs.length > 0;
  const hasResults = selectedRunId !== null && results.length > 0;

  return (
    <div className="space-y-4" role="region" aria-label="Genome breeding panel">
      {/* Breeding configuration */}
      <SectionCard title="Genome Breeding" subtitle="Cross-breed top-performing personas to discover novel configurations">
        <div className="space-y-4">
          <ParentSelector
            personas={personas}
            selectedIds={selectedParents}
            onToggle={toggleParent}
          />

          <ObjectiveSliders objective={objective} onChange={setObjective} />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground" htmlFor="mutation-rate">
                Mutation Rate
              </label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  id="mutation-rate"
                  type="range"
                  min={0}
                  max={50}
                  value={Math.round(mutationRate * 100)}
                  onChange={(e) => setMutationRate(Number(e.target.value) / 100)}
                  aria-label="Mutation rate"
                  className="flex-1 h-1.5 accent-violet-500"
                />
                <span className="text-xs text-muted-foreground w-10 text-right" aria-live="polite">
                  {Math.round(mutationRate * 100)}%
                </span>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground" htmlFor="generations-select">
                Generations
              </label>
              <select
                id="generations-select"
                value={generations}
                onChange={(e) => setGenerations(Number(e.target.value))}
                className="mt-1 w-full text-sm bg-primary/5 border border-primary/10 rounded-md px-2 py-1.5 text-foreground"
              >
                {[1, 2, 3, 4, 5].map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={handleStartBreeding}
            disabled={isBreeding || selectedParents.length < 2}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isBreeding ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Breeding...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" aria-hidden="true" />
                Start Breeding ({selectedParents.length} parents)
              </>
            )}
          </button>
        </div>
      </SectionCard>

      {/* Run history */}
      {hasRunHistory && (
        <SectionCard title="Breeding History">
          <div className="space-y-1.5" role="list" aria-label="Breeding runs">
            {runs.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                isSelected={selectedRunId === run.id}
                onSelect={() => loadResults(run.id)}
                onDelete={() => handleDeleteRun(run.id)}
              />
            ))}
          </div>
        </SectionCard>
      )}

      {/* Evolution chart (shows when offspring have multi-generation data) */}
      {hasResults && results.some((r) => r.generation > 0) && (
        <SectionCard title="Evolution Progress" subtitle="Fitness trajectory across generations">
          <GenerationEvolutionChart results={results} />
        </SectionCard>
      )}

      {/* Offspring results */}
      <AnimatePresence>
        {hasResults && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <SectionCard
              title={`Offspring (${results.length})`}
              subtitle="Adopt top performers as new personas"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {results.map((result) => (
                  <OffspringCard
                    key={result.id}
                    result={result}
                    onAdopt={() => handleAdopt(result.id)}
                    isAdopting={adoptingId === result.id}
                    parentGenomes={parentGenomes}
                  />
                ))}
              </div>
            </SectionCard>
          </motion.div>
        )}
      </AnimatePresence>

      {selectedRunId && results.length === 0 && (
        <div className="text-center py-8 text-muted-foreground/60 text-sm" role="status">
          <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin opacity-30" aria-hidden="true" />
          <p>Breeding in progress...</p>
          <p className="text-xs mt-1">Results will appear when the breeding run completes</p>
        </div>
      )}

      {/* Empty state when no runs exist */}
      {!hasRunHistory && !selectedRunId && <BreedingEmptyState />}
    </div>
  );
}
