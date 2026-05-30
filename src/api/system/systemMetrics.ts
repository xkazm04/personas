import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { SystemMetrics } from "@/lib/bindings/SystemMetrics";
export type { SystemMetrics };

/**
 * Sample the host's current CPU + memory load. Cheap on the Rust side (no
 * process enumeration); the footer load gauge polls this on a ~2s timer.
 * `sampleValid` is false on the very first call (CPU% needs two samples).
 */
export function getSystemMetrics(): Promise<SystemMetrics> {
  return invoke<SystemMetrics>("get_system_metrics");
}
