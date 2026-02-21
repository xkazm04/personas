import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// Credential Negotiator
// ============================================================================

export interface NegotiationStartResult {
  negotiation_id: string;
}

export const startCredentialNegotiation = (
  serviceName: string,
  connector: Record<string, unknown>,
  fieldKeys: string[],
) =>
  invoke<NegotiationStartResult>("start_credential_negotiation", {
    serviceName,
    connector,
    fieldKeys,
  });

export const cancelCredentialNegotiation = () =>
  invoke<void>("cancel_credential_negotiation");

export interface StepHelpResult {
  answer: string;
  updated_url: string | null;
}

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
