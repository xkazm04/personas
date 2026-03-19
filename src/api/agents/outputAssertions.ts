import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { OutputAssertion } from "@/lib/bindings/OutputAssertion";
import type { AssertionResult } from "@/lib/bindings/AssertionResult";
import type { ExecutionAssertionSummary } from "@/lib/bindings/ExecutionAssertionSummary";

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
  assertionType: string;
  config: string;
  severity?: string;
  onFailure?: string;
}) => invoke<OutputAssertion>("create_output_assertion", params);

export const updateOutputAssertion = (params: {
  id: string;
  name?: string;
  description?: string;
  config?: string;
  severity?: string;
  onFailure?: string;
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
