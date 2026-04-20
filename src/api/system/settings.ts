import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { QualityGateConfig } from "@/lib/bindings/QualityGateConfig";

// ============================================================================
// Settings (global key-value store)
// ============================================================================

export const getAppSetting = (key: string) =>
  invoke<string | null>("get_app_setting", { key });

export const setAppSetting = (key: string, value: string) =>
  invoke<void>("set_app_setting", { key, value });

/**
 * Delete an app setting by key. Returns `true` when a row existed and was
 * removed, `false` when the key was absent (idempotent no-op — not an error).
 *
 * Do NOT surface "setting cleared" toasts based on `true` vs `false`: the
 * observable end state is identical (row is gone). Treat the boolean as
 * diagnostic telemetry only.
 */
export const deleteAppSetting = (key: string) =>
  invoke<boolean>("delete_app_setting", { key });

// ============================================================================
// Quality Gate Config
// ============================================================================

export const getQualityGateConfig = () =>
  invoke<QualityGateConfig>("get_quality_gate_config");

export const setQualityGateConfig = (config: QualityGateConfig) =>
  invoke<void>("set_quality_gate_config", { config });

export const resetQualityGateConfig = () =>
  invoke<QualityGateConfig>("reset_quality_gate_config");
