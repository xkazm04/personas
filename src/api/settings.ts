import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// Settings (global key-value store)
// ============================================================================

export const getAppSetting = (key: string) =>
  invoke<string | null>("get_app_setting", { key });

export const setAppSetting = (key: string, value: string) =>
  invoke<void>("set_app_setting", { key, value });

export const deleteAppSetting = (key: string) =>
  invoke<boolean>("delete_app_setting", { key });
