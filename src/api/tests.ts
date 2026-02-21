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
