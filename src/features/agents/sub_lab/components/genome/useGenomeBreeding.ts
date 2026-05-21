import { useState, useCallback, useRef, useEffect } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import * as genomeApi from '@/api/agents/genome';
import type { FitnessObjective } from '@/lib/bindings/FitnessObjective';
import type { GenomeBreedingRun } from '@/lib/bindings/GenomeBreedingRun';
import type { GenomeBreedingResult } from '@/lib/bindings/GenomeBreedingResult';
import type { PersonaGenome } from '@/lib/bindings/PersonaGenome';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';

export function useGenomeBreeding() {
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
      toastCatch('lab:genome-list-runs', 'Failed to load breeding runs')(e);
      return [] as GenomeBreedingRun[];
    });
    setRuns(data);
    setHasLoadedRuns(true);
  }, []);

  const loadResults = useCallback(async (runId: string) => {
    const data = await genomeApi.getBreedingResults(runId).catch((e) => {
      toastCatch('lab:genome-load-results', 'Failed to load breeding results')(e);
      return [] as GenomeBreedingResult[];
    });
    setResults(data);
    setSelectedRunId(runId);

    const run = runs.find((r) => r.id === runId);
    if (run) {
      const parentIds: string[] = parseJsonOrDefault(run.parentIds, []);
      const genomeMap = new Map<string, PersonaGenome>();
      for (const pid of parentIds) {
        try {
          const g = await genomeApi.extractGenome(pid);
          genomeMap.set(pid, g);
        } catch (err) { silentCatch("features/agents/sub_lab/components/genome/useGenomeBreeding:catch1")(err); }
      }
      setParentGenomes(genomeMap);
    }
  }, [runs]);

  // Load breeding runs once. Calling loadRuns() at the top level of the hook
  // body (outside any useEffect) violated the rules of hooks: React 19 strict
  // mode double-invokes render and would double-fire the IPC, and any state
  // update from the async callback could re-render mid-render and re-trigger
  // the call before hasLoadedRuns flipped — risking a fetch loop on slow
  // networks. The effect runs once after first commit.
  useEffect(() => {
    if (!hasLoadedRuns) void loadRuns();
  }, [hasLoadedRuns, loadRuns]);

  const toggleParent = useCallback((id: string) => {
    setSelectedParents((prev) =>
      prev.includes(id)
        ? prev.filter((p) => p !== id)
        : prev.length >= 5 ? prev : [...prev, id],
    );
  }, []);

  const handleStartBreeding = useCallback(async () => {
    if (selectedParents.length < 2) {
      addToast('Select at least 2 parent personas', 'error');
      return;
    }
    setIsBreeding(true);
    try {
      const run = await genomeApi.startBreeding(
        selectedParents, objective, mutationRate, generations,
      );
      addToast('Breeding run started', 'success');
      setRuns((prev) => [run, ...prev]);
      setSelectedRunId(run.id);

      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      pollRef.current = setInterval(async () => {
        const updated = await genomeApi.listBreedingRuns().catch((e) => {
          silentCatch('lab:genome-poll-runs')(e);
          return [] as GenomeBreedingRun[];
        });
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
  }, [selectedParents, objective, mutationRate, generations, addToast, loadResults]);

  const handleAdopt = useCallback(async (resultId: string) => {
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
  }, [addToast]);

  const handleDeleteRun = useCallback(async (id: string) => {
    await genomeApi.deleteBreedingRun(id).catch(toastCatch('genome:deleteBreedingRun', 'Failed to delete breeding run'));
    setRuns((prev) => prev.filter((r) => r.id !== id));
    if (selectedRunId === id) {
      setSelectedRunId(null);
      setResults([]);
      setParentGenomes(new Map());
    }
  }, [selectedRunId]);

  return {
    personas,
    selectedParents, objective, mutationRate, generations, isBreeding,
    runs, selectedRunId, results, adoptingId, parentGenomes,
    setObjective, setMutationRate, setGenerations,
    toggleParent, handleStartBreeding, handleAdopt, handleDeleteRun, loadResults,
    hasRunHistory: runs.length > 0,
    hasResults: selectedRunId !== null && results.length > 0,
  };
}

export type BreedingContext = ReturnType<typeof useGenomeBreeding>;
