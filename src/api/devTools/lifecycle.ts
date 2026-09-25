// Lifecycle v2 - each project's development practice (preset, steps, bindings,
// evidence). Wraps the dev_tools_*_lifecycle* commands in
// src-tauri/src/commands/infrastructure/lifecycle.rs. Every read and write
// returns the whole snapshot; live refresh rides `DEV_TOOLS_LIFECYCLE_CHANGED`
// (`useDevToolsLiveStore().lifecycleRevision`).
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { LifecyclePreset } from "@/lib/bindings/LifecyclePreset";
import type { LifecycleSnapshot } from "@/lib/bindings/LifecycleSnapshot";

/** The project's lifecycle. A project with no stored version reads as Solo v0 (author `default`). */
export const getLifecycle = (projectId: string) =>
  invoke<LifecycleSnapshot>("dev_tools_get_lifecycle", { projectId });

/** Switch to a built-in preset; a no-op returning the current snapshot when it already is. */
export const setLifecyclePreset = (projectId: string, preset: LifecyclePreset) =>
  invoke<LifecycleSnapshot>("dev_tools_set_lifecycle_preset", { projectId, preset });

/** Dispatch the "Install into repo" Run Desk task. Resolves to its task id, or `null` when nothing is missing. */
export const installLifecycle = (projectId: string) =>
  invoke<string | null>("dev_tools_lifecycle_install", { projectId });
