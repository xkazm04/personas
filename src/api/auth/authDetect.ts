import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

export interface AuthDetection {
  service_type: string;
  method: "cli" | "cookie" | "filesystem";
  authenticated: boolean;
  identity: string | null;
  confidence: "high" | "medium" | "low";
}

export async function detectAuthenticatedServices(): Promise<AuthDetection[]> {
  return invoke<AuthDetection[]>("detect_authenticated_services");
}
