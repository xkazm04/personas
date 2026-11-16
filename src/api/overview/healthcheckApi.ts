import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { CredentialDesignHealthcheckResult } from "@/lib/bindings/CredentialDesignHealthcheckResult";

export type { CredentialDesignHealthcheckResult } from "@/lib/bindings/CredentialDesignHealthcheckResult";

/**
 * The backend generates the healthcheck config with one inline Claude CLI call
 * (`run_claude_prompt(.., 300, ..)` in commands/credentials/credential_design.rs)
 * and only then probes the endpoint. At the 90 s default the wrapper reported a
 * failed healthcheck while the backend finished, and a retry paid for a second
 * call. Pinned by `__tests__/healthcheckTimeoutParity.test.ts`, which reads the
 * Rust figure.
 */
const HEALTHCHECK_IPC_TIMEOUT_MS = 330_000;

export const testCredentialDesignHealthcheck = (
  instruction: string,
  connector: Record<string, unknown>,
  fieldValues: Record<string, string>,
) =>
  invoke<CredentialDesignHealthcheckResult>(
    "test_credential_design_healthcheck",
    {
      instruction,
      connector,
      fieldValues,
    },
    { timeoutMs: HEALTHCHECK_IPC_TIMEOUT_MS },
  );
