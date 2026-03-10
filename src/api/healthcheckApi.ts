import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

export interface CredentialDesignHealthcheckResult {
  success: boolean;
  message: string;
  healthcheck_config: Record<string, unknown> | null;
}

export const testCredentialDesignHealthcheck = (
  instruction: string,
  connector: Record<string, unknown>,
  fieldValues: Record<string, string>,
) =>
  invoke<CredentialDesignHealthcheckResult>("test_credential_design_healthcheck", {
    instruction,
    connector,
    fieldValues,
  });
