// Lifecycle v2 - each project's development practice (preset, steps, bindings,
// evidence). Wraps the dev_tools_*_lifecycle* commands in
// src-tauri/src/commands/infrastructure/lifecycle.rs. Every read and write
// returns the whole snapshot; live refresh rides `DEV_TOOLS_LIFECYCLE_CHANGED`
// (`useDevToolsLiveStore().lifecycleRevision`).
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { LifecycleGateCommand } from "@/lib/bindings/LifecycleGateCommand";
import type { LifecycleHistory } from "@/lib/bindings/LifecycleHistory";
import type { LifecyclePreset } from "@/lib/bindings/LifecyclePreset";
import type { LifecycleMeasureStarted } from "@/lib/bindings/LifecycleMeasureStarted";
import type { LifecycleSendPreview } from "@/lib/bindings/LifecycleSendPreview";
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

/** Ask the project's running Measure to stop. Resolves `true` when one was running; unfinished commands land as `did_not_run`. */
export const cancelLifecycleMeasure = (projectId: string) =>
  invoke<boolean>("dev_tools_lifecycle_cancel_measure", { projectId });

/** Layer-2 data for one step: run history (the newest 30 runs per command, newest first), per-doc rot rows, the backlog items about the step, and its evidence history (the newest 200 changes that recorded the step, each with every step's outcome). */
export const getLifecycleStepDetail = (projectId: string, stepId: string) =>
  invoke<LifecycleStepDetail>("dev_tools_lifecycle_step_detail", { projectId, stepId });

/** The Measure history: gate and tests judged at each of the newest 20 Measures (newest first), with their runs. */
export const getLifecycleHistory = (projectId: string) =>
  invoke<LifecycleHistory>("dev_tools_lifecycle_history", { projectId });

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

/** One run's stored output tail (at most 16 KiB; `--- stdout ---` then `--- stderr ---`). `null` = nothing captured (did not run, timed out); `""` = ran silently. Rejects `not_found` for another project's run. */
export const getLifecycleRunOutput = (projectId: string, runId: string) =>
  invoke<string | null>("dev_tools_lifecycle_run_output", { projectId, runId });

/** Dry run of Send to Overseer: the steps that would get a new item, are already open, would be reopened, or are left alone. */
export const previewLifecycleSend = (projectId: string) =>
  invoke<LifecycleSendPreview>("dev_tools_lifecycle_send_preview", { projectId });

/** The commands auto-detection finds in the project's manifests right now, whatever the steps configure. */
export const detectLifecycleCommands = (projectId: string) =>
  invoke<LifecycleGateCommand[]>("dev_tools_lifecycle_detect_commands", { projectId });
