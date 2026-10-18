import { getExecution } from '@/api/agents/executions';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { isTerminalState } from '@/lib/execution/executionState';
import { silentCatch } from '@/lib/silentCatch';

/** How often the row is re-read while the run is still going (a local DB read). */
export const RESULT_POLL_INTERVAL_MS = 1_000;
/** How long a smoke test / playground request waits for its run to land. */
export const RESULT_WAIT_BUDGET_MS = 120_000;

export interface AwaitExecutionOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** Polled before every read; true stops the wait (unmount, superseded). */
  isCancelled?: () => boolean;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wait for a run started by `executePersona` to reach a terminal state.
 *
 * `execute_persona` returns after its SpawnEngine stage, not after the run:
 * the row it hands back is `queued` or `running`, with no output, duration or
 * cost yet (src-tauri/src/commands/execution/executions.rs, "The remaining
 * stages ... run asynchronously"). Reading that row as the verdict reported
 * every deployment smoke test as failed and every playground request as an
 * empty failed run. The bulk re-run hook already waits the same way
 * (`waitForLanding` in sub_executions/libs/useBulkRerun.ts).
 *
 * Resolves the terminal row, or `null` when the wait was cancelled or the
 * budget ran out with the run still going. A failed read is transient - the
 * run itself is unaffected - so it is breadcrumbed and retried.
 */
export async function awaitExecutionResult(
  started: PersonaExecution,
  personaId: string,
  { intervalMs = RESULT_POLL_INTERVAL_MS, timeoutMs = RESULT_WAIT_BUDGET_MS, isCancelled }: AwaitExecutionOptions = {},
): Promise<PersonaExecution | null> {
  if (isTerminalState(started.status)) return started;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() >= deadline) return null;
    await delay(intervalMs);
    if (isCancelled?.()) return null;
    try {
      const row = await getExecution(started.id, personaId);
      if (isTerminalState(row.status)) return row;
    } catch (err) {
      silentCatch('features/agents/sub_deployment/awaitExecutionResult:read')(err);
    }
  }
}
