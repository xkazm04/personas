import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { QualityGateConfig } from "@/lib/bindings/QualityGateConfig";

// ============================================================================
// Settings (global key-value store)
// ============================================================================

export const getAppSetting = (key: string) =>
  invoke<string | null>("get_app_setting", { key });

/**
 * Bulk-read variant of {@link getAppSetting}. Issues a single Tauri invoke
 * (one `SELECT key, value FROM app_settings WHERE key IN (...)`) and returns
 * a map of `{ key: value | null }`.
 *
 * Keys missing from the table are returned with `null`. Unknown keys (not on
 * the Rust allow-list) are also returned with `null`, matching the
 * single-key reader's behaviour for typo'd or stale references.
 *
 * Prefer this when a panel reads multiple keys on mount — each invoke costs
 * ~1-5 ms of serialisation overhead even for cache-hot SQLite, so a fan-out
 * of single reads is meaningfully slower than one bulk call.
 */
export const getAppSettingsBulk = (keys: readonly string[]) =>
  invoke<Record<string, string | null>>("get_app_settings_bulk", {
    keys: [...keys],
  });

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
