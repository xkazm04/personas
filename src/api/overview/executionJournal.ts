import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { ExecutionDataDiff } from "@/lib/bindings/ExecutionDataDiff";
import type { UndoExecutionResult } from "@/lib/bindings/UndoExecutionResult";

// ============================================================================
// Reversible Agent — change journal (Execution Data Diff + undo)
// ============================================================================

/**
 * The exact rows a run created/modified/deleted, newest first, with
 * before-images and a per-row "someone else wrote this row afterwards"
 * conflict prediction.
 */
export const getExecutionDataDiff = (executionId: string) =>
  invoke<ExecutionDataDiff>("get_execution_data_diff", { executionId });

/**
 * Reverse-replay the run's journal in one transaction. Rows modified since
 * by another writer are flagged as conflicts and parked — never clobbered.
 * Consent-gated in the UI (see DataDiffSection) — call only after explicit
 * user confirmation.
 */
export const undoExecution = (executionId: string) =>
  invoke<UndoExecutionResult>("undo_execution", { executionId });
