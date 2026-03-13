import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { CredentialDesignHealthcheckResult } from "@/lib/bindings/CredentialDesignHealthcheckResult";

export type { CredentialDesignHealthcheckResult } from "@/lib/bindings/CredentialDesignHealthcheckResult";

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
