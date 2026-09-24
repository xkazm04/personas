import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { ResponsibilityMeasured } from "@/lib/bindings/ResponsibilityMeasured";

/**
 * What each of a persona's charters ACTUALLY costs per run — ledger aggregate
 * plus peak RSS — for display beside the declared `spec.resourceProfile`.
 * Charters with no measured passes are simply absent from the list.
 */
export const getResponsibilityMeasured = (personaId: string) =>
  invoke<ResponsibilityMeasured[]>("responsibility_measured", { personaId });
