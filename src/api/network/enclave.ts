import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { EnclavePolicy } from "@/lib/bindings/EnclavePolicy";
import type { EnclaveSealResult } from "@/lib/bindings/EnclaveSealResult";
import type { EnclaveVerifyResult } from "@/lib/bindings/EnclaveVerifyResult";

// Re-export types for convenience
export type { EnclavePolicy, EnclaveSealResult, EnclaveVerifyResult };

// ============================================================================
// Seal
// ============================================================================

export const sealEnclave = (personaId: string, policy: EnclavePolicy, savePath: string) =>
  invoke<EnclaveSealResult>("seal_enclave", { personaId, policy, savePath });

// ============================================================================
// Verify
// ============================================================================

export const verifyEnclave = (filePath: string) =>
  invoke<EnclaveVerifyResult>("verify_enclave", { filePath });
