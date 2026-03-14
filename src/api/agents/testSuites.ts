import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaTestSuite } from "@/lib/bindings/PersonaTestSuite";

export const listTestSuites = (personaId: string) =>
  invoke<PersonaTestSuite[]>("list_test_suites", { personaId });

export const getTestSuite = (id: string) =>
  invoke<PersonaTestSuite>("get_test_suite", { id });

export const createTestSuite = (
  personaId: string,
  name: string,
  scenarios: string,
  scenarioCount: number,
  description?: string,
  sourceRunId?: string,
) =>
  invoke<PersonaTestSuite>("create_test_suite", {
    personaId,
    name,
    description: description,
    scenarios,
    scenarioCount,
    sourceRunId: sourceRunId,
  });

export const updateTestSuite = (
  id: string,
  name?: string,
  description?: string,
  scenarios?: string,
  scenarioCount?: number,
) =>
  invoke<PersonaTestSuite>("update_test_suite", {
    id,
    name: name,
    description: description,
    scenarios: scenarios,
    scenarioCount: scenarioCount,
  });

export const deleteTestSuite = (id: string) =>
  invoke<boolean>("delete_test_suite", { id });
