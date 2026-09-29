/**
 * Lifecycle v2 - confirming Athena's `lifecycle_proposal` chat card.
 *
 * Backend mirror: `companion_apply_lifecycle_proposal` in
 * `src-tauri/src/commands/companion/approvals/approval_exec_lifecycle.rs`.
 * The proposal itself is NOT sent: the backend reads it back from the durable
 * card row by id, applies only the ticked changes on top of the version the
 * card was drawn from, and refuses when the project has moved past it.
 */
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';

/**
 * The confirm can start the Run Desk install task after the version is saved,
 * so it gets more room than the default IPC timeout.
 */
const APPLY_TIMEOUT_MS = 60_000;

/**
 * Apply the ticked changes of a lifecycle proposal card.
 * `acceptedStepIds` are the changes' `stepId`s (`"preset"` for a preset switch).
 * Resolves to the project's new snapshot (its `installTaskId` is set when the
 * new version needed repo bindings installed).
 */
export const applyLifecycleProposal = (cardId: string, acceptedStepIds: string[]) =>
  invoke<LifecycleSnapshot>(
    'companion_apply_lifecycle_proposal',
    { cardId, acceptedStepIds },
    { timeoutMs: APPLY_TIMEOUT_MS },
  );
