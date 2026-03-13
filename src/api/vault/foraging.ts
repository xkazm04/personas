import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { ForageSource } from "@/lib/bindings/ForageSource";
import type { ForageConfidence } from "@/lib/bindings/ForageConfidence";
import type { ForagedCredential } from "@/lib/bindings/ForagedCredential";
import type { ForagingScanResult } from "@/lib/bindings/ForagingScanResult";
import type { ForageImportResult } from "@/lib/bindings/ForageImportResult";
export type { ForageSource, ForageConfidence, ForagedCredential, ForagingScanResult, ForageImportResult };

// -- API calls ----------------------------------------------------------

export const scanCredentialSources = () =>
  invoke<ForagingScanResult>("scan_credential_sources");

export const importForagedCredential = (
  foragedId: string,
  credentialName: string,
  serviceType: string,
) =>
  invoke<ForageImportResult>("import_foraged_credential", {
    foragedId,
    credentialName,
    serviceType,
  });
