import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';

import type { PolicyProposal } from '@/lib/bindings/PolicyProposal';
import type { PolicyTuningGenerationReport } from '@/lib/bindings/PolicyTuningGenerationReport';

export type { PolicyProposal, PolicyTuningGenerationReport };

/**
 * Self-Tuning Fabric v1 (batch-3). Review-each only — the ONLY policy writer
 * is `policyTuningApply`, invoked per proposal after the operator inspects
 * the evidence drawer. Generation is read-only over telemetry plus inserts
 * into the proposals ledger.
 */
export const policyTuningGenerate = (windowDays?: number) =>
  invoke<PolicyTuningGenerationReport>('policy_tuning_generate', { windowDays });

export const policyTuningList = (onlyPending?: boolean, limit?: number) =>
  invoke<PolicyProposal[]>('policy_tuning_list', { onlyPending, limit });

export const policyTuningApply = (id: string) =>
  invoke<PolicyProposal>('policy_tuning_apply', { id });

export const policyTuningDecline = (id: string, reason?: string) =>
  invoke<PolicyProposal>('policy_tuning_decline', { id, reason });
