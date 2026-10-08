// Lifecycle v2 - each project's development practice (preset, steps, bindings,
// evidence). Wraps the dev_tools_*_lifecycle* commands in
// src-tauri/src/commands/infrastructure/lifecycle.rs. Every read and write
// returns the whole snapshot; live refresh rides `DEV_TOOLS_LIFECYCLE_CHANGED`
// (`useDevToolsLiveStore().lifecycleRevision`).
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { LifecyclePreset } from "@/lib/bindings/LifecyclePreset";
import type { LifecycleMeasureStarted } from "@/lib/bindings/LifecycleMeasureStarted";
import type { LifecycleSendResult } from "@/lib/bindings/LifecycleSendResult";
import type { LifecycleSnapshot } from "@/lib/bindings/LifecycleSnapshot";
import type { LifecycleStepDetail } from "@/lib/bindings/LifecycleStepDetail";
import type { LifecycleStepParams } from "@/lib/bindings/LifecycleStepParams";
import type { LifecycleWatchedPipeline } from "@/lib/bindings/LifecycleWatchedPipeline";

/** The project's lifecycle. A project with no stored version reads as Solo v0 (author `default`). */
export const getLifecycle = (projectId: string) =>
  invoke<LifecycleSnapshot>("dev_tools_get_lifecycle", { projectId });

/** Switch to a built-in preset; a no-op returning the current snapshot when it already is. */
export const setLifecyclePreset = (projectId: string, preset: LifecyclePreset) =>
  invoke<LifecycleSnapshot>("dev_tools_set_lifecycle_preset", { projectId, preset });

/** Dispatch the "Install into repo" Run Desk task. Resolves to its task id, or `null` when nothing is missing. */
export const installLifecycle = (projectId: string) =>
  invoke<string | null>("dev_tools_lifecycle_install", { projectId });

/** Run the project's gate/test/coverage commands on the base tip, timed. Returns at once; rows land via `lifecycleRevision`. */
export const measureLifecycle = (projectId: string) =>
  invoke<LifecycleMeasureStarted>("dev_tools_lifecycle_measure", { projectId });

/** Layer-2 data for one step: run history (newest first, at most 30) and per-doc rot rows. */
export const getLifecycleStepDetail = (projectId: string, stepId: string) =>
  invoke<LifecycleStepDetail>("dev_tools_lifecycle_step_detail", { projectId, stepId });

/** Replace one step's params (gate commands, thresholds); appends a version authored `operator`. */
export const setLifecycleStepParams = (projectId: string, stepId: string, params: LifecycleStepParams) =>
  invoke<LifecycleSnapshot>("dev_tools_lifecycle_set_step_params", { projectId, stepId, params });

/** Star / unstar the project for the Overseer. Resolves to the new state. */
export const setLifecycleWatch = (projectId: string, watched: boolean) =>
  invoke<boolean>("dev_tools_lifecycle_set_watch", { projectId, watched });

/** Hand the pipeline to the Overseer: the "All steps green" goal plus one accepted item per non-green step. */
export const sendLifecycleToOverseer = (projectId: string) =>
  invoke<LifecycleSendResult>("dev_tools_lifecycle_send_to_overseer", { projectId });

/** Every Overseer-watched project with goal progress and last measure. */
export const listOverseerWatchedPipelines = () =>
  invoke<LifecycleWatchedPipeline[]>("dev_tools_overseer_watched_pipelines", {});
