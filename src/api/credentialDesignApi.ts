import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DesignStartResult } from "./design";

export const startCredentialDesign = (instruction: string) =>
  invoke<DesignStartResult>("start_credential_design", { instruction });

export const cancelCredentialDesign = () =>
  invoke<void>("cancel_credential_design");
