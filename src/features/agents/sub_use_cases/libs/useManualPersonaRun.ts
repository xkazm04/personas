import { useCallback, useRef, useState } from 'react';
import { executePersona } from '@/api/agents/executions';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { createLogger } from '@/lib/log';

const logger = createLogger('manual-persona-run');

// Window during which a repeated manual run reuses the previous run's
// idempotency key so the backend collapses an accidental rapid repeat into a
// single execution. Kept short: a DELIBERATE re-run (the user waits for the run
// to start and decides to fire again) lands outside this window and mints a
// fresh key, so intentional repeats still spawn a new paid run.
const MANUAL_RUN_DEDUPE_MS = 1000;

export interface ManualPersonaRunParams {
  /** Persona the run targets. Also the value re-checked against the live
   * store below to catch a fast persona switch between render and click. */
  personaId: string;
  /** Used only for the budget-blocked toast copy; falls back to a generic label. */
  personaName?: string | null;
  useCaseId: string;
  /** Fixture/sample inputs for the run. Omitted (undefined body) when empty
   * so the runner falls back to the persona's default input contract. */
  inputs?: Record<string, unknown> | null;
  /** toastCatch context tag — keep it call-site-specific so Sentry breadcrumbs
   * and log lines can be traced back to which UI surface triggered the run. */
  errorContext: string;
}

/**
 * Manual real-execution trigger, shared by every "Run now" affordance that
 * calls the production `execute_persona` IPC directly: real CLI spawn, real
 * cost, and — crucially — any `emit_event` protocol messages the persona
 * sends fire downstream listeners. That's how chained capabilities (UC1 →
 * UC2 across personas) can be exercised on demand without waiting for a
 * schedule tick.
 *
 * Owns:
 * - `runInFlightRef`: a synchronous reentrancy guard. `isManualRunning` is
 *   React state captured in the closure, so two click handlers in the same
 *   render commit both read the pre-disable `false` and each spawn a real
 *   (paid) CLI run. This ref is set synchronously the instant we commit to a
 *   run and cleared in `finally`, so a second click sees it before any
 *   re-render lands and bails immediately.
 * - The stale-persona re-check: the caller's `personaId` is a snapshot taken
 *   at click entry. If a fast persona switch happened between the last
 *   render and this click, that snapshot is stale and we'd otherwise spawn a
 *   real (paid) production CLI run against the wrong agent — and any
 *   emit_event payloads that fire would cascade as if the old agent produced
 *   them. Re-read the live store value and abort if the user has navigated
 *   away.
 * - The budget gate: this calls the raw `execute_persona` IPC directly,
 *   bypassing the store action where the pause normally lives, so a
 *   budget-exceeded/stale persona could spend through this button while the
 *   Runner UI shows it paused. (Server-side enforcement in
 *   execute_persona_inner is the deeper fix; the backend has no budget-pause
 *   state today.)
 * - The `MANUAL_RUN_DEDUPE_MS` idempotency-key window.
 */
export function useManualPersonaRun() {
  const [isManualRunning, setIsManualRunning] = useState(false);
  // Synchronous reentrancy guard — see doc comment above.
  const runInFlightRef = useRef(false);
  // Last manual run's start time + idempotency key, used to dedupe accidental
  // rapid repeats (see MANUAL_RUN_DEDUPE_MS).
  const lastRunRef = useRef<{ at: number; key: string } | null>(null);

  const run = useCallback(
    async ({ personaId, personaName, useCaseId, inputs, errorContext }: ManualPersonaRunParams) => {
      if (!personaId || runInFlightRef.current || isManualRunning) return;

      // Snapshot the persona at click entry (the caller's `personaId`). If a
      // fast persona switch happened between the last render and this click,
      // that snapshot is stale — re-read the live store value and abort if
      // the user has navigated away.
      const expectedPersonaId = personaId;
      const liveSelectedId = useAgentStore.getState().selectedPersona?.id ?? null;
      if (liveSelectedId !== expectedPersonaId) {
        logger.warn('Manual run aborted: persona changed between render and click', {
          expectedPersonaId,
          liveSelectedId,
          useCaseId,
        });
        return;
      }

      // Enforce the budget pause here too — see doc comment above.
      if (useAgentStore.getState().isBudgetBlocked(expectedPersonaId)) {
        useToastStore.getState().addToast(
          `Budget enforcement for "${personaName ?? 'persona'}" — execution blocked (budget exceeded or data unavailable)`,
          'error',
        );
        return;
      }

      // Claim the in-flight slot synchronously, before the first `await`, so
      // a second click in this same render commit is rejected by the guard
      // above.
      runInFlightRef.current = true;
      setIsManualRunning(true);

      // Derive a stable idempotency key. A repeat that slips through within
      // the dedupe window (e.g. a buffered second click after a
      // fast-settling run) reuses the previous key, so the server gate
      // collapses the two into one execution. A later deliberate re-run is
      // outside the window and mints a fresh key, so the backend treats it
      // as a new, distinct run.
      const now = Date.now();
      const prevRun = lastRunRef.current;
      const idempotencyKey =
        prevRun && now - prevRun.at < MANUAL_RUN_DEDUPE_MS ? prevRun.key : crypto.randomUUID();
      lastRunRef.current = { at: now, key: idempotencyKey };

      try {
        // Pass undefined when there are no inputs so the runner uses the
        // persona's default input contract.
        const inputData =
          inputs && Object.keys(inputs).length > 0 ? JSON.stringify(inputs) : undefined;
        const exec = await executePersona(
          expectedPersonaId,
          undefined,
          inputData,
          useCaseId,
          undefined,
          idempotencyKey,
        );
        logger.info('Manual run started', { executionId: exec?.id, useCaseId });
      } catch (err) {
        toastCatch(errorContext, 'Failed to start manual execution')(err);
      } finally {
        // Clear the synchronous guard on BOTH success and error so a
        // genuinely failed run can be retried.
        runInFlightRef.current = false;
        setIsManualRunning(false);
      }
    },
    [isManualRunning],
  );

  return { isManualRunning, run };
}
