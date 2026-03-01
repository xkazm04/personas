import { useCallback } from "react";
import { usePersonaStore } from "@/stores/personaStore";
import * as api from "@/api/tauriApi";
import type { DryRunResult } from "@/api/triggers";
import type { PersonaExecution } from "@/lib/bindings/PersonaExecution";

// ─── Result types ────────────────────────────────────────────────────────

export interface TriggerOpResult<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface TestFireResult {
  execution?: PersonaExecution;
  validationFailures?: string;
}

// ─── Hook ────────────────────────────────────────────────────────────────

/**
 * Centralises all trigger CRUD + test operations.
 *
 * Every operation returns `{ ok, data?, error? }` so callers get a
 * consistent shape and can decide how to present the outcome (toast,
 * inline message, ignore, …).
 */
export function useTriggerOperations(personaId: string) {
  const storeCreate = usePersonaStore((s) => s.createTrigger);
  const storeUpdate = usePersonaStore((s) => s.updateTrigger);
  const storeDelete = usePersonaStore((s) => s.deleteTrigger);
  const fetchTriggerChains = usePersonaStore((s) => s.fetchTriggerChains);

  // ── Create ─────────────────────────────────────────────────────────────

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

  // ── Toggle ─────────────────────────────────────────────────────────────

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

  // ── Delete ─────────────────────────────────────────────────────────────

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

  // ── Delete chain (also refreshes chain list) ───────────────────────────

  const removeChain = useCallback(
    async (triggerId: string, targetPersonaId: string): Promise<TriggerOpResult> => {
      try {
        await storeDelete(targetPersonaId, triggerId);
        await fetchTriggerChains();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errStr(err) };
      }
    },
    [storeDelete, fetchTriggerChains],
  );

  // ── Create chain (also refreshes chain list) ──────────────────────────

  const createChain = useCallback(
    async (
      sourcePersonaId: string,
      targetPersonaId: string,
      conditionType: string,
    ): Promise<TriggerOpResult> => {
      try {
        await storeCreate(targetPersonaId, {
          trigger_type: "chain",
          config: {
            source_persona_id: sourcePersonaId,
            event_type: "chain_triggered",
            condition: { type: conditionType },
            payload_forward: true,
          },
          enabled: true,
        });
        await fetchTriggerChains();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errStr(err) };
      }
    },
    [storeCreate, fetchTriggerChains],
  );

  // ── Validate ───────────────────────────────────────────────────────────

  const validate = useCallback(
    async (triggerId: string): Promise<TriggerOpResult<{ valid: boolean; failures: string }>> => {
      try {
        const validation = await api.validateTrigger(triggerId);
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

  // ── Test Fire (validate → execute) ─────────────────────────────────────

  const testFire = useCallback(
    async (triggerId: string, triggerPersonaId?: string): Promise<TriggerOpResult<TestFireResult>> => {
      const pid = triggerPersonaId ?? personaId;
      try {
        const validation = await api.validateTrigger(triggerId);
        if (!validation.valid) {
          const failedChecks = validation.checks
            .filter((c) => !c.passed)
            .map((c) => `${c.label}: ${c.message}`)
            .join("; ");
          return { ok: false, data: { validationFailures: failedChecks }, error: `Validation failed — ${failedChecks}` };
        }
        const execution = await api.executePersona(pid, triggerId);
        return { ok: true, data: { execution } };
      } catch (err) {
        return { ok: false, error: errStr(err) };
      }
    },
    [personaId],
  );

  // ── Dry Run ────────────────────────────────────────────────────────────

  const dryRun = useCallback(
    async (triggerId: string): Promise<TriggerOpResult<DryRunResult>> => {
      try {
        const result = await api.dryRunTrigger(triggerId);
        return { ok: true, data: result };
      } catch (err) {
        return { ok: false, error: errStr(err) };
      }
    },
    [],
  );

  // ── Activity log ───────────────────────────────────────────────────────

  const fetchActivity = useCallback(
    async (triggerId: string, triggerPersonaId?: string): Promise<TriggerOpResult<PersonaExecution[]>> => {
      const pid = triggerPersonaId ?? personaId;
      try {
        const execs = await api.listExecutions(pid, 50);
        const filtered = execs.filter((e) => e.trigger_id === triggerId).slice(0, 10);
        return { ok: true, data: filtered };
      } catch (err) {
        return { ok: false, error: errStr(err) };
      }
    },
    [personaId],
  );

  return {
    create,
    toggle,
    remove,
    createChain,
    removeChain,
    validate,
    testFire,
    dryRun,
    fetchActivity,
  } as const;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function errStr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "error" in err)
    return String((err as Record<string, unknown>).error);
  return "Unknown error";
}
