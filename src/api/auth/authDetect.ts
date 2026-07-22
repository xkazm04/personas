import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { AuthDetection } from "@/lib/bindings/AuthDetection";
import type { AuthDetectionInfo } from "@/hooks/design/credential/useCredentialNegotiator";
export type { AuthDetection };

export async function detectAuthenticatedServices(): Promise<AuthDetection[]> {
  return invoke<AuthDetection[]>("detect_authenticated_services");
}

/**
 * Adapt raw snake_case `AuthDetection` results (as returned by the backend)
 * into the camelCase `AuthDetectionInfo` shape the negotiator consumes,
 * keeping only entries that are actually authenticated.
 */
export function toAuthDetectionInfo(detections: AuthDetection[]): AuthDetectionInfo[] {
  return detections
    .filter((d) => d.authenticated)
    .map((d) => ({
      serviceType: d.service_type,
      method: d.method,
      authenticated: d.authenticated,
      identity: d.identity,
      confidence: d.confidence,
    }));
}
