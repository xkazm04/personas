import { useCallback } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { executePersona, listExecutionsByTrigger } from "@/api/agents/executions";
import { dryRunTrigger, validateTrigger } from "@/api/pipeline/triggers";

import type { DryRunResult } from "@/api/pipeline/triggers";
import type { PersonaExecution } from "@/lib/bindings/PersonaExecution";
import { useTranslation } from "@/i18n/useTranslation";

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
  const { t, tx } = useTranslation();
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
        return { ok: false, error: errStr(err, t.common.unknown_error) };
      }
    },
    [personaId, storeCreate, t.common.unknown_error],
  );

  // -- Toggle -------------------------------------------------------------

  const toggle = useCallback(
    async (triggerId: string, currentEnabled: boolean): Promise<TriggerOpResult> => {
      try {
        await storeUpdate(personaId, triggerId, { enabled: !currentEnabled });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errStr(err, t.common.unknown_error) };
      }
    },
    [personaId, storeUpdate, t.common.unknown_error],
  );

  // -- Delete -------------------------------------------------------------

  const remove = useCallback(
    async (triggerId: string): Promise<TriggerOpResult> => {
      try {
        await storeDelete(personaId, triggerId);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errStr(err, t.common.unknown_error) };
      }
    },
    [personaId, storeDelete, t.common.unknown_error],
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
        return { ok: false, error: errStr(err, t.common.unknown_error) };
      }
    },
    [t.common.unknown_error],
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
          return {
            ok: false,
            data: { validationFailures: failedChecks },
            error: tx(t.triggers.validation_failed_with_details, { failures: failedChecks }),
          };
        }
        const execution = await executePersona(pid, triggerId);
        return { ok: true, data: { execution } };
      } catch (err) {
        return { ok: false, error: errStr(err, t.common.unknown_error) };
      }
    },
    [personaId, tx, t.triggers.validation_failed_with_details, t.common.unknown_error],
  );

  // -- Dry Run ------------------------------------------------------------

  const dryRun = useCallback(
    async (triggerId: string): Promise<TriggerOpResult<DryRunResult>> => {
      try {
        const result = await dryRunTrigger(triggerId);
        return { ok: true, data: result };
      } catch (err) {
        return { ok: false, error: errStr(err, t.common.unknown_error) };
      }
    },
    [t.common.unknown_error],
  );

  // -- Activity log -------------------------------------------------------

  const fetchActivity = useCallback(
    async (triggerId: string, _triggerPersonaId?: string): Promise<TriggerOpResult<PersonaExecution[]>> => {
      try {
        const execs = await listExecutionsByTrigger(triggerId, 10);
        return { ok: true, data: execs };
      } catch (err) {
        return { ok: false, error: errStr(err, t.common.unknown_error) };
      }
    },
    [t.common.unknown_error],
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

function errStr(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "error" in err)
    return String((err as Record<string, unknown>).error);
  return fallback;
}
