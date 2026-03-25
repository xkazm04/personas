import { useCallback } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { executePersona, listExecutionsByTrigger } from "@/api/agents/executions";
import { dryRunTrigger, validateTrigger } from "@/api/pipeline/triggers";

import type { DryRunResult } from "@/api/pipeline/triggers";
import type { PersonaExecution } from "@/lib/bindings/PersonaExecution";

// --- Result types --------------------------------------------------------

export interface TriggerOpResult<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface TestFireResult {
  execution?: PersonaExecution;
  validationFailures?: string;
}

// --- Hook ----------------------------------------------------------------

/**
 * Centralises all trigger CRUD + test operations.
 *
 * Every operation returns `{ ok, data?, error? }` so callers get a
 * consistent shape and can decide how to present the outcome (toast,
 * inline message, ignore, ...).
 */
export function useTriggerOperations(personaId: string) {
  const storeCreate = usePipelineStore((s) => s.createTrigger);
  const storeUpdate = usePipelineStore((s) => s.updateTrigger);
  const storeDelete = usePipelineStore((s) => s.deleteTrigger);

  // -- Create -------------------------------------------------------------

  const create = useCallback(
    async (
      triggerType: string,
      config?: Record<string, unknown>,
      opts?: { enabled?: boolean; useCaseId?: string | null },
    ): Promise<TriggerOpResult> => {
      try {
        await storeCreate(personaId, {
          trigger_type: triggerType,
          config,
          enabled: opts?.enabled ?? true,
          use_case_id: opts?.useCaseId ?? null,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errStr(err) };
      }
    },
    [personaId, storeCreate],
  );

  // -- Toggle -------------------------------------------------------------

  const toggle = useCallback(
    async (triggerId: string, currentEnabled: boolean): Promise<TriggerOpResult> => {
      try {
        await storeUpdate(personaId, triggerId, { enabled: !currentEnabled });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errStr(err) };
      }
    },
    [personaId, storeUpdate],
  );

  // -- Delete -------------------------------------------------------------

  const remove = useCallback(
    async (triggerId: string): Promise<TriggerOpResult> => {
      try {
        await storeDelete(personaId, triggerId);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errStr(err) };
      }
    },
    [personaId, storeDelete],
  );

  // -- Validate -----------------------------------------------------------

  const validate = useCallback(
    async (triggerId: string): Promise<TriggerOpResult<{ valid: boolean; failures: string }>> => {
      try {
        const validation = await validateTrigger(triggerId);
        if (!validation.valid) {
          const failedChecks = validation.checks
            .filter((c) => !c.passed)
            .map((c) => `${c.label}: ${c.message}`)
            .join("; ");
          return { ok: true, data: { valid: false, failures: failedChecks } };
        }
        return { ok: true, data: { valid: true, failures: "" } };
      } catch (err) {
        return { ok: false, error: errStr(err) };
      }
    },
    [],
  );

  // -- Test Fire (validate -> execute) -------------------------------------

  const testFire = useCallback(
    async (triggerId: string, triggerPersonaId?: string): Promise<TriggerOpResult<TestFireResult>> => {
      const pid = triggerPersonaId ?? personaId;
      try {
        const validation = await validateTrigger(triggerId);
        if (!validation.valid) {
          const failedChecks = validation.checks
            .filter((c) => !c.passed)
            .map((c) => `${c.label}: ${c.message}`)
            .join("; ");
          return { ok: false, data: { validationFailures: failedChecks }, error: `Validation failed -- ${failedChecks}` };
        }
        const execution = await executePersona(pid, triggerId);
        return { ok: true, data: { execution } };
      } catch (err) {
        return { ok: false, error: errStr(err) };
      }
    },
    [personaId],
  );

  // -- Dry Run ------------------------------------------------------------

  const dryRun = useCallback(
    async (triggerId: string): Promise<TriggerOpResult<DryRunResult>> => {
      try {
        const result = await dryRunTrigger(triggerId);
        return { ok: true, data: result };
      } catch (err) {
        return { ok: false, error: errStr(err) };
      }
    },
    [],
  );

  // -- Activity log -------------------------------------------------------

  const fetchActivity = useCallback(
    async (triggerId: string, _triggerPersonaId?: string): Promise<TriggerOpResult<PersonaExecution[]>> => {
      try {
        const execs = await listExecutionsByTrigger(triggerId, 10);
        return { ok: true, data: execs };
      } catch (err) {
        return { ok: false, error: errStr(err) };
      }
    },
    [],
  );

  return {
    create,
    toggle,
    remove,
    validate,
    testFire,
    dryRun,
    fetchActivity,
  } as const;
}

// --- Helpers -------------------------------------------------------------

function errStr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "error" in err)
    return String((err as Record<string, unknown>).error);
  return "Unknown error";
}
