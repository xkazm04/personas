import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { NegotiationStartResult } from "@/lib/bindings/NegotiationStartResult";
import type { StepHelpResult } from "@/lib/bindings/StepHelpResult";
export type { NegotiationStartResult, StepHelpResult };

// ============================================================================
// Credential Negotiator
// ============================================================================

export const startCredentialNegotiation = (
  serviceName: string,
  connector: Record<string, unknown>,
  fieldKeys: string[],
  authenticatedServices?: Array<Record<string, unknown>>,
) =>
  invoke<NegotiationStartResult>("start_credential_negotiation", {
    serviceName,
    connector,
    fieldKeys,
    authenticatedServices: authenticatedServices ?? null,
  });

export const cancelCredentialNegotiation = () =>
  invoke<void>("cancel_credential_negotiation");

/**
 * The command runs a Claude prompt inline with a 120 s hard timeout
 * (negotiator.rs `get_negotiation_step_help`). Kept above it so the backend
 * times out and reports first; at the 90 s IPC default the UI showed a failure
 * for answers that arrived between 90 and 120 s. Pinned by
 * __tests__/negotiatorTimeoutParity.test.ts against the Rust literal.
 */
const STEP_HELP_TIMEOUT_MS = 150_000;

export const getNegotiationStepHelp = (
  serviceName: string,
  stepIndex: number,
  stepTitle: string,
  userQuestion: string,
) =>
  invoke<StepHelpResult>(
    "get_negotiation_step_help",
    {
      serviceName,
      stepIndex,
      stepTitle,
      userQuestion,
    },
    { timeoutMs: STEP_HELP_TIMEOUT_MS },
  );
