/**
 * PersonaCompiler — explicit compilation pipeline abstraction.
 *
 * The design workflow is structurally a multi-stage compiler:
 *   wizard input → NL instruction → LLM prompt → Claude CLI → structured JSON → DB writes
 *
 * This module makes the compiler metaphor explicit so that:
 * - Refinement is simply "recompilation with additional constraints"
 * - New compilation stages (validation, optimization, dry-run) can be added
 *   without touching the UI layer
 * - The 7-phase state machine maps cleanly to compiler stages
 */

import type { CompilationStage } from '@/lib/bindings/CompilationStage';
import type { DesignPhase, DesignAnalysisResult, DesignQuestion } from '@/lib/types/designTypes';

// Re-export the binding type
export type { CompilationStage };

// ── Stage Metadata ──────────────────────────────────────────────

export interface CompilationStageInfo {
  stage: CompilationStage;
  label: string;
  description: string;
}

/** All compilation stages in pipeline order with display metadata. */
export const COMPILATION_STAGES: CompilationStageInfo[] = [
  {
    stage: 'prompt_assembly',
    label: 'Assembling prompt',
    description: 'Building the LLM prompt from persona configuration and instruction',
  },
  {
    stage: 'llm_generation',
    label: 'Generating with AI',
    description: 'Running Claude to produce the persona design',
  },
  {
    stage: 'result_parsing',
    label: 'Parsing output',
    description: 'Extracting structured JSON from the LLM response',
  },
  {
    stage: 'feasibility_check',
    label: 'Checking feasibility',
    description: 'Validating suggested tools and connectors are available',
  },
  {
    stage: 'persist',
    label: 'Saving result',
    description: 'Writing the compiled design to the database',
  },
];

// ── Phase → Stage Mapping ────────────────────────────────────────

/**
 * Map the design phase state machine to the currently active compilation stage.
 *
 * This bridges the UI's 7-phase model to the compiler's 5-stage pipeline,
 * making it possible for UI components to show which compilation stage
 * is currently executing.
 */
export function phaseToStage(phase: DesignPhase): CompilationStage | null {
  switch (phase) {
    case 'analyzing':
    case 'refining':
      // During analysis/refinement, the backend is running stages 1-3
      // (prompt assembly → LLM generation → result parsing)
      return 'llm_generation';
    case 'preview':
      // Preview means parsing and feasibility are complete
      return 'feasibility_check';
    case 'applying':
      // Applying means we're in the persist stage
      return 'persist';
    case 'awaiting-input':
      // Question arrived during result parsing
      return 'result_parsing';
    case 'idle':
    case 'applied':
      return null;
    default:
      return null;
  }
}

/**
 * Get the index (0-based) of the active stage in the pipeline.
 * Returns -1 if no stage is active (idle/applied).
 */
export function activeStageIndex(phase: DesignPhase): number {
  const stage = phaseToStage(phase);
  if (!stage) return -1;
  return COMPILATION_STAGES.findIndex((s) => s.stage === stage);
}

// ── Compilation Mode ────────────────────────────────────────────

/** Whether this compilation is initial or a refinement (recompilation). */
export type CompilationMode = 'initial' | 'recompile';

/**
 * Determine the compilation mode from the current state.
 * If there's an existing result being refined, it's a recompilation.
 */
export function getCompilationMode(
  phase: DesignPhase,
  existingResult: DesignAnalysisResult | null,
): CompilationMode {
  if (phase === 'refining' || (existingResult && phase !== 'idle')) {
    return 'recompile';
  }
  return 'initial';
}

// ── Compiler Result Types ────────────────────────────────────────

/** The outcome of a compilation pass. */
export type CompilationOutcome =
  | { kind: 'success'; result: DesignAnalysisResult }
  | { kind: 'question'; question: DesignQuestion }
  | { kind: 'error'; error: string };

/**
 * Build a CompilationOutcome from the current hook state.
 * This is a pure derivation — no side effects.
 */
export function deriveOutcome(
  phase: DesignPhase,
  result: DesignAnalysisResult | null,
  question: DesignQuestion | null,
  error: string | null,
): CompilationOutcome | null {
  if (phase === 'preview' && result) {
    return { kind: 'success', result };
  }
  if (phase === 'awaiting-input' && question) {
    return { kind: 'question', question };
  }
  if (error && (phase === 'idle' || phase === 'preview')) {
    return { kind: 'error', error };
  }
  return null;
}
