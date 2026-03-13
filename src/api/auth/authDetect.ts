import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { AuthDetection } from "@/lib/bindings/AuthDetection";
export type { AuthDetection };

export async function detectAuthenticatedServices(): Promise<AuthDetection[]> {
  return invoke<AuthDetection[]>("detect_authenticated_services");
}
