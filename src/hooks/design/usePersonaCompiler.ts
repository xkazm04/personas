/**
 * usePersonaCompiler — compiler-oriented wrapper around useDesignAnalysis.
 *
 * Provides a clean API where:
 * - `compile()` starts an initial compilation from instruction
 * - `recompile()` refines an existing result with additional constraints
 * - `answerAndContinue()` answers a clarification question and resumes compilation
 * - `applyCompilation()` persists the compiled result to the persona
 *
 * Internally delegates to the same Tauri streaming infrastructure.
 */

import { useMemo } from 'react';
import { useDesignAnalysis } from './useDesignAnalysis';
import {
  type CompilationMode,
  type CompilationOutcome,
  COMPILATION_STAGES,
  phaseToStage,
  activeStageIndex,
  getCompilationMode,
  deriveOutcome,
} from '@/lib/compiler/personaCompiler';

export function usePersonaCompiler() {
  const design = useDesignAnalysis();

  // Derive compiler-specific state from the design hook
  const currentStage = useMemo(() => phaseToStage(design.phase), [design.phase]);
  const stageIndex = useMemo(() => activeStageIndex(design.phase), [design.phase]);
  const isCompiling = design.phase === 'analyzing' || design.phase === 'refining';
  const mode: CompilationMode = useMemo(
    () => getCompilationMode(design.phase, design.result),
    [design.phase, design.result],
  );
  const outcome: CompilationOutcome | null = useMemo(
    () => deriveOutcome(design.phase, design.result, design.question, design.error),
    [design.phase, design.result, design.question, design.error],
  );

  return {
    // ── Compiler state ─────────────────────────────────────────
    /** Current compilation stage (null when idle/applied). */
    currentStage,
    /** Index of the current stage in the pipeline (0-based, -1 when inactive). */
    stageIndex,
    /** Whether a compilation is actively running. */
    isCompiling,
    /** Whether this is an initial compile or a recompilation with constraints. */
    mode,
    /** The outcome of the last compilation pass. */
    outcome,
    /** All stages with metadata for progress display. */
    stages: COMPILATION_STAGES,

    // ── Raw design state (pass-through) ────────────────────────
    phase: design.phase,
    outputLines: design.outputLines,
    result: design.result,
    error: design.error,
    question: design.question,

    // ── Compiler actions ───────────────────────────────────────
    /** Start initial compilation from an instruction. */
    compile: design.startAnalysis,
    /** Recompile with additional constraints (refinement feedback). */
    recompile: design.refineAnalysis,
    /** Answer a clarification question and resume compilation. */
    answerAndContinue: design.answerQuestion,
    /** Cancel the current compilation. */
    cancel: design.cancelAnalysis,
    /** Apply the compiled result to the persona. */
    applyCompilation: design.applyResult,
    /** Reset the compiler to idle state. */
    reset: design.reset,
    /** Set the conversation ID for multi-turn context. */
    setConversationId: design.setConversationId,
  };
}
