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

export const getNegotiationStepHelp = (
  serviceName: string,
  stepIndex: number,
  stepTitle: string,
  userQuestion: string,
) =>
  invoke<StepHelpResult>("get_negotiation_step_help", {
    serviceName,
    stepIndex,
    stepTitle,
    userQuestion,
  });
