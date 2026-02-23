import { invoke } from "@tauri-apps/api/core";

import type { PersonaTestRun } from "@/lib/bindings/PersonaTestRun";
import type { PersonaTestResult } from "@/lib/bindings/PersonaTestResult";

export interface ModelTestConfig {
  id: string;
  provider: string;
  model?: string;
  base_url?: string;
  auth_token?: string;
}

export const startTestRun = (personaId: string, models: ModelTestConfig[]) =>
  invoke<PersonaTestRun>("start_test_run", { personaId, models });

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

// ── Draft Validation ────────────────────────────────────────────

export interface ToolIssue {
  tool_name: string;
  issue: string;
}

export interface DraftValidationResult {
  passed: boolean;
  error: string | null;
  output_preview: string | null;
  tool_issues: ToolIssue[];
}

export const validateN8nDraft = (draftJson: string): Promise<DraftValidationResult> =>
  invoke<DraftValidationResult>("validate_n8n_draft", { draftJson });

export const testN8nDraft = (testId: string, draftJson: string): Promise<void> =>
  invoke<void>("test_n8n_draft", { testId, draftJson });
