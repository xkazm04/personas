import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { EvalRunSummary } from "@/lib/bindings/EvalRunSummary";
import type { TeamCertStatus } from "@/lib/bindings/TeamCertStatus";
import type { EvalRunDetail } from "@/lib/bindings/EvalRunDetail";

export type { EvalRunSummary } from "@/lib/bindings/EvalRunSummary";
export type { TeamCertStatus } from "@/lib/bindings/TeamCertStatus";
export type { EvalRunDetail } from "@/lib/bindings/EvalRunDetail";

/**
 * Read-only viewer over the eval/certification bundles in `docs/test/runs/`.
 * These commands are dev-only (the backend resolves the runs dir from the repo
 * cwd in dev) and return empty/`NotFound` gracefully when no bundles exist.
 */

/** All run summaries, newest first. */
export const fetchEvalRuns = () => invoke<EvalRunSummary[]>("list_eval_runs");

/** Per-team certification status (streak / certified / verdict distribution). */
export const fetchCertStatus = () => invoke<TeamCertStatus[]>("get_cert_status");

/** Full detail for a single run (scorecard + run metadata + team trajectory). */
export const fetchEvalRun = (runId: string) =>
  invoke<EvalRunDetail>("get_eval_run", { runId });
