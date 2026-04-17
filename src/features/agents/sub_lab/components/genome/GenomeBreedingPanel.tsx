import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Play, Loader2,
} from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import * as genomeApi from '@/api/agents/genome';
import type { FitnessObjective } from '@/lib/bindings/FitnessObjective';
import type { GenomeBreedingRun } from '@/lib/bindings/GenomeBreedingRun';
import type { GenomeBreedingResult } from '@/lib/bindings/GenomeBreedingResult';
import type { PersonaGenome } from '@/lib/bindings/PersonaGenome';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { GenerationEvolutionChart } from './GenerationEvolutionChart';
import { toastCatch } from '@/lib/silentCatch';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { log } from '@/lib/log';
import { errMsg } from '@/stores/storeTypes';
import { useTranslation } from '@/i18n/useTranslation';
import {
  ParentSelector, ObjectiveSliders, OffspringCard,
  RunCard, BreedingEmptyState,
} from './GenomeBreedingParts';

// ============================================================================
// Main panel
// ============================================================================

export function GenomeBreedingPanel() {
  const { t } = useTranslation();
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
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const loadRuns = useCallback(async () => {
    const data = await genomeApi.listBreedingRuns().catch((e) => {
      log.warn('genome', 'listBreedingRuns failed', { error: errMsg(e, 'Failed to list breeding runs') });
      return [] as GenomeBreedingRun[];
    });
    setRuns(data);
    setHasLoadedRuns(true);
  }, []);

  const loadResults = useCallback(async (runId: string) => {
    const data = await genomeApi.getBreedingResults(runId).catch((e) => {
      log.warn('genome', 'getBreedingResults failed', { error: errMsg(e, 'Failed to get breeding results') });
      return [] as GenomeBreedingResult[];
    });
    setResults(data);
    setSelectedRunId(runId);

    // Extract parent genomes for diff view
    const run = runs.find((r) => r.id === runId);
    if (run) {
      const parentIds: string[] = parseJsonOrDefault(run.parentIds, []);
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
        if (!mountedRef.current) return;
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
    await genomeApi.deleteBreedingRun(id).catch(toastCatch('genome:deleteBreedingRun', 'Failed to delete breeding run'));
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
              <label className="text-xs font-medium text-foreground" htmlFor="mutation-rate">
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
                <span className="text-xs text-foreground w-10 text-right" aria-live="polite">
                  {Math.round(mutationRate * 100)}%
                </span>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground" htmlFor="generations-select">
                Generations
              </label>
              <select
                id="generations-select"
                value={generations}
                onChange={(e) => setGenerations(Number(e.target.value))}
                className="mt-1 w-full text-sm bg-primary/5 border border-primary/10 rounded-input px-2 py-1.5 text-foreground"
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
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-card bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
      {hasResults && (
        <div className="animate-fade-slide-in">
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
        </div>
      )}

      {selectedRunId && results.length === 0 && (
        <div className="text-center py-8 text-foreground text-sm" role="status">
          <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin opacity-30" aria-hidden="true" />
          <p>{t.agents.lab.breeding_in_progress}</p>
          <p className="text-xs mt-1">Results will appear when the breeding run completes</p>
        </div>
      )}

      {/* Empty state when no runs exist */}
      {!hasRunHistory && !selectedRunId && <BreedingEmptyState />}
    </div>
  );
}
