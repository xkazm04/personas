import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { OutputAssertion } from "@/lib/bindings/OutputAssertion";
import type { AssertionType } from "@/lib/bindings/AssertionType";
import type { AssertionFailureAction } from "@/lib/bindings/AssertionFailureAction";
import type { AssertionResult } from "@/lib/bindings/AssertionResult";
import type { ExecutionAssertionSummary } from "@/lib/bindings/ExecutionAssertionSummary";

/** Severity values the backend accepts (`info` | `warning` | `critical`); ts-rs exports no type for it. */
export type AssertionSeverity = "info" | "warning" | "critical";

// ============================================================================
// Assertion Definitions
// ============================================================================

export const listOutputAssertions = (personaId: string) =>
  invoke<OutputAssertion[]>("list_output_assertions", { personaId });

export const getOutputAssertion = (id: string) =>
  invoke<OutputAssertion>("get_output_assertion", { id });

export const createOutputAssertion = (params: {
  personaId: string;
  name: string;
  description?: string;
  assertionType: AssertionType;
  config: string;
  severity?: AssertionSeverity;
  onFailure?: AssertionFailureAction;
}) => invoke<OutputAssertion>("create_output_assertion", params);

export const updateOutputAssertion = (params: {
  id: string;
  name?: string;
  description?: string;
  config?: string;
  severity?: AssertionSeverity;
  onFailure?: AssertionFailureAction;
  enabled?: boolean;
}) => invoke<OutputAssertion>("update_output_assertion", params);

export const deleteOutputAssertion = (id: string) =>
  invoke<boolean>("delete_output_assertion", { id });

// ============================================================================
// Assertion Results
// ============================================================================

export const getAssertionResultsForExecution = (executionId: string) =>
  invoke<ExecutionAssertionSummary>("get_assertion_results_for_execution", {
    executionId,
  });

export const getAssertionResultHistory = (
  assertionId: string,
  limit?: number,
) =>
  invoke<AssertionResult[]>("get_assertion_result_history", {
    assertionId,
    limit,
  });
