import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaGenome } from "@/lib/bindings/PersonaGenome";
import type { FitnessScore } from "@/lib/bindings/FitnessScore";
import type { FitnessObjective } from "@/lib/bindings/FitnessObjective";
import type { GenomeBreedingRun } from "@/lib/bindings/GenomeBreedingRun";
import type { GenomeBreedingResult } from "@/lib/bindings/GenomeBreedingResult";
import type { Persona } from "@/lib/bindings/Persona";

// ============================================================================
// Genome extraction & fitness
// ============================================================================

export const extractGenome = (personaId: string) =>
  invoke<PersonaGenome>("genome_extract", { personaId });

export const computeFitness = (personaId: string, objective?: FitnessObjective) =>
  invoke<FitnessScore>("genome_fitness", { personaId, objective });

// ============================================================================
// Breeding runs
// ============================================================================

export const startBreeding = (
  parentIds: string[],
  fitnessObjective: FitnessObjective,
  mutationRate?: number,
  generations?: number,
) =>
  invoke<GenomeBreedingRun>("genome_start_breeding", {
    parentIds,
    fitnessObjective,
    mutationRate,
    generations,
  });

export const listBreedingRuns = (projectId?: string, limit?: number) =>
  invoke<GenomeBreedingRun[]>("genome_list_breeding_runs", { projectId, limit });

export const getBreedingResults = (runId: string) =>
  invoke<GenomeBreedingResult[]>("genome_get_breeding_results", { runId });

export const deleteBreedingRun = (id: string) =>
  invoke<boolean>("genome_delete_breeding_run", { id });

// ============================================================================
// Adopt offspring
// ============================================================================

export const adoptOffspring = (resultId: string, name?: string) =>
  invoke<Persona>("genome_adopt_offspring", { resultId, name });
