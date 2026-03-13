import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaTestRun } from "@/lib/bindings/PersonaTestRun";
import type { PersonaTestResult } from "@/lib/bindings/PersonaTestResult";
import type { ModelTestConfig } from "@/lib/bindings/ModelTestConfig";
import type { DraftValidationResult } from "@/lib/bindings/DraftValidationResult";

export type { ModelTestConfig } from "@/lib/bindings/ModelTestConfig";
export type { ToolIssue } from "@/lib/bindings/ToolIssue";
export type { DraftValidationResult } from "@/lib/bindings/DraftValidationResult";

export const startTestRun = (personaId: string, models: ModelTestConfig[], useCaseFilter?: string, suiteId?: string, fixtureInputs?: Record<string, unknown>) =>
  invoke<PersonaTestRun>("start_test_run", { personaId, models, useCaseFilter: useCaseFilter ?? null, suiteId: suiteId ?? null, fixtureInputs: fixtureInputs ? JSON.stringify(fixtureInputs) : null });

export const listTestRuns = (personaId: string, limit?: number) =>
  invoke<PersonaTestRun[]>("list_test_runs", {
    personaId,
    limit: limit ?? null,
  });

export const getTestResults = (testRunId: string) =>
  invoke<PersonaTestResult[]>("get_test_results", { testRunId });

export const deleteTestRun = (id: string) =>
  invoke<boolean>("delete_test_run", { id });

export const cancelTestRun = (id: string) =>
  invoke<void>("cancel_test_run", { id });

// -- Draft Validation --------------------------------------------

export const validateN8nDraft = (draftJson: string): Promise<DraftValidationResult> =>
  invoke<DraftValidationResult>("validate_n8n_draft", { draftJson });

export const testN8nDraft = (testId: string, draftJson: string): Promise<void> =>
  invoke<void>("test_n8n_draft", { testId, draftJson });
